/**
 * Sparks Pane (V2)
 *
 * "Sparks" mode UI: upload/paste the same game-account export as Roster mode
 * (data.json), then browse every owned horse's sparks (succession factors).
 * Sortable by total white spark count, searchable by specific sparks (search
 * results sort by that spark's star level), with a detail modal showing the
 * full inheritance tree (self + 2 parents + 4 grandparents) for judging which
 * horse to pick as a breeding candidate.
 *
 * Copyright (c) 2026 TheCing (https://github.com/TheCing/uma-tools)
 * Licensed under GPL-3.0-or-later
 */

import { h, Fragment } from 'preact';
import { useState, useCallback, useMemo, useRef, useEffect } from 'preact/hooks';
import { Upload, Search, X } from 'lucide-react';

import { Modal, Button, Switch } from './components';
import type { UmaState } from './uma-panel';
import { RosterUploadModal } from './roster-upload';
import {
	resolveCourseAptitudes,
	type ParsedRosterHorse,
	type RosterParseResult,
	type SuccessionChara,
} from './roster-parser';
import {
	summarizeSparks,
	treeFactorIds,
	starsOfSpark,
	buildSparkIndex,
	type Spark,
	type SparkSummary,
	type SparkIndexEntry,
} from './sparks';

interface SparksPaneProps {
	/** Parsed roster horses (shared with Roster mode). */
	horses: ParsedRosterHorse[];
	/** Course surface of the currently-selected course (1=Turf, 2=Dirt) — for upload parsing. */
	courseSurface: 1 | 2;
	/** Course distanceType — resolves aptitudes when loading a horse into compare. */
	courseDistanceType: number;
	/** Called with the freshly-parsed roster when the user uploads/pastes. */
	onRosterParsed: (parsed: RosterParseResult) => void;
	/** Load a horse into Uma 1 or Uma 2 and switch to compare mode. */
	onSelectHorse: (uma: UmaState, slot: 1 | 2) => void;
}

type SortKey = 'white' | 'stars' | 'name' | 'match';

/** Spark type -> CSS modifier for the colored chip (game spark colors). */
function sparkTypeClass(type: number): string {
	switch (type) {
		case 1: return 'v2-spark-blue';
		case 2: return 'v2-spark-pink';
		case 3: return 'v2-spark-green';
		case 4: return 'v2-spark-white';
		case 5: return 'v2-spark-race';
		case 6: return 'v2-spark-scenario';
		default: return 'v2-spark-other';
	}
}

const SPARK_TYPE_LABEL: Record<number, string> = {
	1: 'Stat', 2: 'Aptitude', 3: 'Unique', 4: 'Skill', 5: 'Race', 6: 'Scenario',
};

function starPips(stars: number) {
	return <span class="v2-spark-stars">{'★'.repeat(stars)}</span>;
}

/** A single spark chip: colored by type, name + star pips. */
function SparkChip({ spark, highlight }: { spark: Spark; highlight?: boolean }) {
	return (
		<span
			class={`v2-spark-chip ${sparkTypeClass(spark.type)}${highlight ? ' match' : ''}`}
			title={`${SPARK_TYPE_LABEL[spark.type] ?? 'Spark'} · ${spark.stars}★`}
		>
			<span class="v2-spark-chip-name">{spark.name}</span>
			{starPips(spark.stars)}
		</span>
	);
}

/** Compact one-line spark list for a tree member (detail modal). */
function SparkChipRow({ summary, matchNames }: { summary: SparkSummary; matchNames: Set<string> }) {
	const all = [
		...(summary.blue ? [summary.blue] : []),
		...(summary.pink ? [summary.pink] : []),
		...summary.green,
		...summary.whiteSkill,
		...summary.whiteRace,
		...summary.whiteScenario,
		...summary.other,
	];
	return (
		<div class="v2-sparks-chip-row">
			{all.map(s => <SparkChip key={s.id} spark={s} highlight={matchNames.has(s.name)} />)}
		</div>
	);
}

export function SparksPane({
	horses,
	courseSurface,
	courseDistanceType,
	onRosterParsed,
	onSelectHorse,
}: SparksPaneProps) {
	const [uploadOpen, setUploadOpen] = useState(false);
	const [sortKey, setSortKey] = useState<SortKey>('white');
	// Count/search the whole inheritance tree (self + parents + grandparents) vs self only.
	const [includeTree, setIncludeTree] = useState(false);
	// Spark search: free-text query + the set of selected spark names filtering the list.
	const [query, setQuery] = useState('');
	const [selectedSparks, setSelectedSparks] = useState<string[]>([]);
	const [suggestOpen, setSuggestOpen] = useState(false);
	const [activeIdx, setActiveIdx] = useState(0);
	const searchRef = useRef<HTMLInputElement>(null);
	const searchWrapRef = useRef<HTMLDivElement>(null);
	// The horse whose detail modal is open, or null.
	const [detail, setDetail] = useState<ParsedRosterHorse | null>(null);

	const loadHorse = useCallback((horse: ParsedRosterHorse, slot: 1 | 2) => {
		const { distanceAptitude, surfaceAptitude } = resolveCourseAptitudes(horse, courseDistanceType, courseSurface);
		onSelectHorse({ ...horse.uma, distanceAptitude, surfaceAptitude }, slot);
	}, [onSelectHorse, courseDistanceType, courseSurface]);

	// Per-horse spark summaries for both scopes (self / full tree).
	const summaries = useMemo(() =>
		horses.map(horse => ({
			self: summarizeSparks(horse.factors),
			tree: summarizeSparks(treeFactorIds(horse)),
		})),
	[horses]);

	// Search index over every spark name in the roster (scope follows the tree toggle).
	const sparkIndex = useMemo(() => buildSparkIndex(horses, includeTree), [horses, includeTree]);

	// Autocomplete suggestions: substring match, most-common sparks first.
	const suggestions = useMemo(() => {
		const q = query.trim().toUpperCase();
		if (q.length === 0) return [];
		return sparkIndex
			.filter(e => e.name.toUpperCase().indexOf(q) !== -1 && !selectedSparks.includes(e.name))
			.sort((a, b) => b.umaCount - a.umaCount || a.name.localeCompare(b.name))
			.slice(0, 30);
	}, [sparkIndex, query, selectedSparks]);

	const addSpark = useCallback((name: string) => {
		setSelectedSparks(prev => prev.includes(name) ? prev : [...prev, name]);
		// Searching for a specific spark implies ranking by its star level.
		setSortKey('match');
		setQuery('');
		setSuggestOpen(false);
		setActiveIdx(0);
		searchRef.current?.focus();
	}, []);

	const removeSpark = useCallback((name: string) => {
		setSelectedSparks(prev => prev.filter(n => n !== name));
	}, []);

	// Match-star sort only makes sense while a spark filter is active.
	useEffect(() => {
		if (selectedSparks.length === 0) setSortKey(k => (k === 'match' ? 'white' : k));
	}, [selectedSparks]);

	// Close the suggestion dropdown on outside click.
	useEffect(() => {
		if (!suggestOpen) return;
		const onDown = (e: MouseEvent) => {
			if (!searchWrapRef.current?.contains(e.target as Node)) setSuggestOpen(false);
		};
		document.addEventListener('mousedown', onDown);
		return () => document.removeEventListener('mousedown', onDown);
	}, [suggestOpen]);

	// Keep the keyboard cursor in range when the suggestion list shrinks
	// (e.g. toggling "Include parents" drops ancestor-only sparks).
	useEffect(() => {
		setActiveIdx(i => Math.min(i, Math.max(0, suggestions.length - 1)));
	}, [suggestions]);

	const handleSearchKey = useCallback((e: KeyboardEvent) => {
		if (!suggestOpen) {
			// Dropdown dismissed: ArrowDown reopens it; Enter/ArrowUp must not
			// act on hidden suggestions the user explicitly dismissed.
			if (e.key === 'ArrowDown' && suggestions.length > 0) {
				e.preventDefault();
				setSuggestOpen(true);
				setActiveIdx(0);
			}
			return;
		}
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			setActiveIdx(i => Math.min(i + 1, suggestions.length - 1));
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			setActiveIdx(i => Math.max(i - 1, 0));
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (suggestions[activeIdx]) addSpark(suggestions[activeIdx].name);
		} else if (e.key === 'Escape') {
			setSuggestOpen(false);
		}
	}, [suggestOpen, suggestions, activeIdx, addSpark]);

	// Filter by selected sparks, compute match stars, and sort.
	const rows = useMemo(() => {
		const joined = horses.map((horse, i) => {
			const summary = includeTree ? summaries[i].tree : summaries[i].self;
			const scopeIds = includeTree ? treeFactorIds(horse) : horse.factors;
			// Sum of the selected sparks' star levels (0 for a missing spark).
			let matchStars = 0;
			let matchedAll = true;
			for (const name of selectedSparks) {
				const stars = starsOfSpark(scopeIds, name);
				if (stars === 0) matchedAll = false;
				matchStars += stars;
			}
			return { horse, self: summaries[i].self, summary, matchStars, matchedAll };
		});
		const filtered = selectedSparks.length > 0 ? joined.filter(r => r.matchedAll) : joined;
		const sorted = filtered.slice();
		switch (sortKey) {
			case 'match':
				sorted.sort((a, b) => b.matchStars - a.matchStars
					|| b.summary.whiteCount - a.summary.whiteCount
					|| b.summary.whiteStars - a.summary.whiteStars);
				break;
			case 'stars':
				sorted.sort((a, b) => b.summary.whiteStars - a.summary.whiteStars
					|| b.summary.whiteCount - a.summary.whiteCount);
				break;
			case 'name':
				sorted.sort((a, b) => a.horse.name.localeCompare(b.horse.name));
				break;
			case 'white':
			default:
				sorted.sort((a, b) => b.summary.whiteCount - a.summary.whiteCount
					|| b.summary.whiteStars - a.summary.whiteStars);
				break;
		}
		return sorted;
	}, [horses, summaries, includeTree, selectedSparks, sortKey]);

	const matchNames = useMemo(() => new Set(selectedSparks), [selectedSparks]);
	const hasFilter = selectedSparks.length > 0;

	// Detail modal summaries (self + each tree member), computed only when open.
	const detailData = useMemo(() => {
		if (!detail) return null;
		return {
			self: summarizeSparks(detail.factors),
			tree: summarizeSparks(treeFactorIds(detail)),
			members: detail.succession.map(s => ({ chara: s, summary: summarizeSparks(s.factors) })),
		};
	}, [detail]);

	return (
		<div class="v2-roster-pane v2-sparks-pane">
			<div class="v2-roster-controls">
				<Button
					variant="secondary"
					icon={<Upload size={14} />}
					onClick={() => setUploadOpen(true)}
				>
					{horses.length > 0 ? `Roster: ${horses.length} horses` : 'Upload data.json'}
				</Button>

				{horses.length > 0 && (
					<>
						<div class="v2-sparks-search" ref={searchWrapRef}>
							<Search size={16} class="v2-sparks-search-icon" />
							<input
								ref={searchRef}
								type="text"
								placeholder="Search sparks (e.g. Long, Kyoto, Right-Handed)…"
								value={query}
								onInput={(e) => {
									setQuery((e.target as HTMLInputElement).value);
									setSuggestOpen(true);
									setActiveIdx(0);
								}}
								onFocus={() => query.trim().length > 0 && setSuggestOpen(true)}
								onKeyDown={handleSearchKey}
							/>
							{suggestOpen && suggestions.length > 0 && (
								<div class="v2-sparks-suggest">
									{suggestions.map((s, i) => (
										<button
											type="button"
											key={s.name}
											class={`v2-sparks-suggest-item${i === activeIdx ? ' active' : ''}`}
											onMouseDown={(e) => {
												if (e.button !== 0) return; // primary click only
												e.preventDefault(); // keep input focus
												addSpark(s.name);
											}}
											onMouseEnter={() => setActiveIdx(i)}
										>
											<span class={`v2-sparks-suggest-dot ${sparkTypeClass(s.type)}`} />
											<span class="v2-sparks-suggest-name">{s.name}</span>
											<span class="v2-sparks-suggest-meta">
												{s.umaCount} uma{s.umaCount === 1 ? '' : 's'} · up to {s.maxStars}★
											</span>
										</button>
									))}
								</div>
							)}
						</div>

						<Switch
							checked={includeTree}
							onChange={setIncludeTree}
							label="Include parents"
						/>

						<div class="v2-roster-sort">
							<span>Sort by</span>
							{hasFilter && (
								<button
									type="button"
									class={sortKey === 'match' ? 'active' : ''}
									onClick={() => setSortKey('match')}
									title="Star level of the searched spark(s)"
								>Match ★</button>
							)}
							<button
								type="button"
								class={sortKey === 'white' ? 'active' : ''}
								onClick={() => setSortKey('white')}
								title="Total white spark count"
							>Whites</button>
							<button
								type="button"
								class={sortKey === 'stars' ? 'active' : ''}
								onClick={() => setSortKey('stars')}
								title="Total white spark stars"
							>White ★</button>
							<button
								type="button"
								class={sortKey === 'name' ? 'active' : ''}
								onClick={() => setSortKey('name')}
							>Name</button>
						</div>
					</>
				)}
			</div>

			{hasFilter && (
				<div class="v2-sparks-filters">
					{selectedSparks.map(name => (
						<span key={name} class="v2-sparks-filter-chip">
							{name}
							<button type="button" onClick={() => removeSpark(name)} title="Remove filter">
								<X size={12} />
							</button>
						</span>
					))}
					<span class="v2-sparks-filter-count">
						{rows.length} / {horses.length} horses
					</span>
				</div>
			)}

			{horses.length === 0 ? (
				<div class="v2-roster-empty">
					<p>Upload your account export to browse every horse's sparks and find breeding candidates.</p>
					<p class="v2-roster-empty-hint">
						Uses the same data.json as Roster mode — a JSON array of trained characters.
						Sparks (factors) are read for each horse and its full inheritance tree.
					</p>
				</div>
			) : (
				<div class="v2-roster-table-wrap">
					<table class="v2-roster-table v2-sparks-table">
						<thead>
							<tr>
								<th class="v2-roster-rank">#</th>
								<th class="v2-roster-name">Horse</th>
								<th>Blue</th>
								<th>Pink</th>
								<th class="v2-roster-num" title="Unique (green) sparks">Green</th>
								<th class="v2-roster-num" title={`White spark count (skill + race + scenario)${includeTree ? ', whole tree' : ''}`}>
									Whites{includeTree ? ' (tree)' : ''}
								</th>
								<th class="v2-roster-num" title="Sum of stars across white sparks">White ★</th>
								<th class="v2-roster-num" title="Race (G1) sparks">Races</th>
								{hasFilter && <th class="v2-roster-num" title="Stars of the searched spark(s)">Match ★</th>}
								<th class="v2-roster-load-col">Load</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((row, i) => {
								const { horse, self, summary } = row;
								return (
									<tr
										class="v2-roster-row"
										key={horse.trainedCharaId || i}
										onClick={() => setDetail(horse)}
										title="View full sparks & inheritance tree"
									>
										<td class="v2-roster-rank">{i + 1}</td>
										<td class="v2-roster-name">
											<img
												class="v2-roster-icon"
												src={horse.iconUrl}
												alt=""
												loading="lazy"
												onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')}
											/>
											<span>{horse.name}</span>
										</td>
										<td>
											{self.blue
												? <span class="v2-spark-cell v2-spark-blue">{self.blue.name} {starPips(self.blue.stars)}</span>
												: '—'}
										</td>
										<td>
											{self.pink
												? <span class="v2-spark-cell v2-spark-pink">{self.pink.name} {starPips(self.pink.stars)}</span>
												: '—'}
										</td>
										<td class="v2-roster-num">
											{self.green.length > 0
												? <span class="v2-spark-cell v2-spark-green">{self.green.reduce((n, s) => n + s.stars, 0)}★</span>
												: '—'}
										</td>
										<td class="v2-roster-num v2-sparks-white-count">{summary.whiteCount}</td>
										<td class="v2-roster-num">{summary.whiteStars}★</td>
										<td class="v2-roster-num">{summary.whiteRace.length}</td>
										{hasFilter && (
											<td class="v2-roster-num v2-sparks-match-stars">
												{row.matchStars > 0 ? `${row.matchStars}★` : '—'}
											</td>
										)}
										<td class="v2-roster-load-col">
											<div class="v2-roster-load-btns">
												<button
													type="button"
													class="v2-roster-load-btn"
													title="Load into Uma 1"
													onClick={(e) => { e.stopPropagation(); loadHorse(horse, 1); }}
												>→1</button>
												<button
													type="button"
													class="v2-roster-load-btn"
													title="Load into Uma 2"
													onClick={(e) => { e.stopPropagation(); loadHorse(horse, 2); }}
												>→2</button>
											</div>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}

			<RosterUploadModal
				isOpen={uploadOpen}
				onClose={() => setUploadOpen(false)}
				courseSurface={courseSurface}
				onRosterParsed={onRosterParsed}
				description={'Upload or paste your game-account export (a JSON array of trained ' +
					'characters). Every owned horse’s sparks and inheritance tree will be ' +
					'browsable and searchable.'}
			/>

			<Modal
				isOpen={detail != null}
				onClose={() => setDetail(null)}
				title={detail?.name}
				size="xl"
				className="v2-sparks-detail-modal"
				footer={detail && (
					<div class="v2-roster-detail-actions">
						<Button variant="secondary" onClick={() => { loadHorse(detail, 1); setDetail(null); }}>
							Load into Uma 1
						</Button>
						<Button variant="secondary" onClick={() => { loadHorse(detail, 2); setDetail(null); }}>
							Load into Uma 2
						</Button>
					</div>
				)}
			>
				{detail && detailData && (
					<div class="v2-sparks-detail">
						{/* Header: portrait + name + tree-wide totals */}
						<div class="v2-roster-detail-card v2-roster-detail-head">
							<img
								class="v2-roster-detail-icon"
								src={detail.iconUrl}
								alt=""
								onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')}
							/>
							<div class="v2-roster-detail-head-info">
								<div class="v2-roster-detail-name">{detail.name}</div>
								<div class="v2-roster-detail-sub">
									<span>{'★'.repeat(detail.uma.starCount)}</span>
								</div>
							</div>
							<div class="v2-sparks-detail-totals">
								<div class="v2-sparks-total">
									<span class="v2-sparks-total-value">{detailData.self.whiteCount}</span>
									<span class="v2-sparks-total-label">own whites</span>
								</div>
								<div class="v2-sparks-total">
									<span class="v2-sparks-total-value">{detailData.tree.whiteCount}</span>
									<span class="v2-sparks-total-label">tree whites</span>
								</div>
								<div class="v2-sparks-total">
									<span class="v2-sparks-total-value">{detailData.tree.whiteStars}★</span>
									<span class="v2-sparks-total-label">tree white ★</span>
								</div>
							</div>
						</div>

						{/* Own sparks, grouped like the game */}
						<div class="v2-roster-detail-card">
							<div class="v2-roster-detail-section-header">
								<span>Own Sparks</span>
								<span class="v2-roster-detail-badge">
									{detail.factors.length} sparks · {detailData.self.totalStars}★
								</span>
							</div>
							<SparkChipRow summary={detailData.self} matchNames={matchNames} />
						</div>

						{/* Inheritance tree: parent 1 (+2 grandparents), parent 2 (+2 grandparents) */}
						<div class="v2-roster-detail-card">
							<div class="v2-roster-detail-section-header">
								<span>Inheritance Tree</span>
								<span class="v2-roster-detail-badge">
									{detailData.tree.whiteCount} whites · {detailData.tree.whiteStars}★ total
								</span>
							</div>
							{detailData.members.length === 0 ? (
								<div class="v2-roster-detail-empty">No inheritance data in the export.</div>
							) : (
								<div class="v2-sparks-tree">
									{detailData.members.map(({ chara, summary }) => (
										<div
											key={chara.positionId}
											class={`v2-sparks-tree-member${chara.positionId % 10 === 0 ? ' parent' : ' grandparent'}`}
										>
											<div class="v2-sparks-tree-head">
												<img
													class="v2-sparks-tree-icon"
													src={chara.iconUrl}
													alt=""
													loading="lazy"
													onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')}
												/>
												<span class="v2-sparks-tree-name">{chara.name}</span>
												<span class="v2-sparks-tree-role">
													{chara.positionId % 10 === 0 ? 'Parent' : 'Grandparent'}
												</span>
												<span class="v2-sparks-tree-whites">
													{summary.whiteCount} whites · {summary.whiteStars}★
												</span>
											</div>
											<SparkChipRow summary={summary} matchNames={matchNames} />
										</div>
									))}
								</div>
							)}
						</div>
					</div>
				)}
			</Modal>
		</div>
	);
}
