/**
 * Roster Pane (V2)
 *
 * "Roster" mode UI: upload/paste a game-account export (data.json), then rank
 * every owned horse by mean finish time (with median for consistency) on the
 * currently-configured course + conditions. Clicking a row loads that horse into
 * Uma 1 for a detailed compare.
 *
 * Copyright (c) 2026 TheCing (https://github.com/TheCing/uma-tools)
 * Licensed under GPL-3.0-or-later
 */

import { h, Fragment } from 'preact';
import { useState, useCallback, useMemo } from 'preact/hooks';
import { Upload } from 'lucide-react';

import { Modal, Button, Textarea, Switch } from './components';
import type { UmaState } from './uma-panel';
import { STAT_ICONS, statRankIconUrl, aptitudeRankIconUrl, CollapsibleSection } from './uma-panel';
import { getSkillName, getSkillIcon, getSkillRarityClass } from './skills';
import { computeSkillSp } from './skill-chart-utils';
import {
	parseRoster,
	resolveCourseAptitudes,
	type ParsedRosterHorse,
	type RosterParseResult,
} from './roster-parser';

export interface RosterResult {
	index: number;
	meanTime: number;
	medianTime: number;
	minTime: number;
	maxTime: number;
	stdTime: number;
	fullSpurtRate: number;
	sampleCount: number;
}

interface RosterPaneProps {
	/** Parsed roster horses (filtered), in the order they were submitted to the worker. */
	horses: ParsedRosterHorse[];
	/** Per-horse finish-time results from the worker (joined by `index`). */
	results: RosterResult[];
	/** Course surface of the currently-selected course (1=Turf, 2=Dirt) — re-parses aptitudes on upload. */
	courseSurface: 1 | 2;
	/** Course distanceType (1=Sprint, 2=Mile, 3=Mid, 4=Long) — selects course-matched distance aptitude for display/load. */
	courseDistanceType: number;
	/** Whether a run is in progress. */
	isRunning: boolean;
	/** Progress {done,total} during a run, or null. */
	progress: { done: number; total: number } | null;
	/** Sample count per horse. */
	samples: number;
	setSamples: (n: number) => void;
	/** Called with the freshly-parsed roster when the user uploads/pastes. */
	onRosterParsed: (parsed: RosterParseResult) => void;
	/** Load a horse into Uma 1 or Uma 2 and switch to compare mode. */
	onSelectHorse: (uma: UmaState, slot: 1 | 2) => void;
}

/** Aptitude grade -> CSS modifier class (for color coding S..G). */
function aptClass(grade: string): string {
	return 'v2-roster-apt-' + grade.toLowerCase();
}

const STRATEGY_LABEL: Record<string, string> = {
	Nige: 'Front',
	Senkou: 'Pace',
	Sasi: 'Late',
	Oikomi: 'End',
	Oonige: 'Front (Oo)',
};

// Full strategy names (matches the uma config panel's Style row).
const STRATEGY_FULL: Record<string, string> = {
	Oonige: 'Runaway',
	Nige: 'Front Runner',
	Senkou: 'Pace Chaser',
	Sasi: 'Late Surger',
	Oikomi: 'End Closer',
};

// Per game mechanics: DisplayedTime = ActualTime * 1.18 (matches compare mode).
// Duplicated inline intentionally (no shared helper) per project decision.
function fmtTime(t: number): string {
	if (!isFinite(t)) return '—';
	const displayed = t * 1.18;
	const minutes = Math.floor(displayed / 60);
	const remainingSeconds = displayed % 60;
	return `${minutes}:${remainingSeconds.toFixed(3).padStart(6, '0')}`;
}

export function RosterPane({
	horses,
	results,
	courseSurface,
	courseDistanceType,
	isRunning,
	progress,
	samples,
	setSamples,
	onRosterParsed,
	onSelectHorse,
}: RosterPaneProps) {
	const [uploadOpen, setUploadOpen] = useState(false);
	const [pasteText, setPasteText] = useState('');
	const [parseError, setParseError] = useState<string | null>(null);
	const [includeRentals, setIncludeRentals] = useState(false);
	const [includeStubs, setIncludeStubs] = useState(false);
	const [sortKey, setSortKey] = useState<'mean' | 'median'>('mean');
	// The horse whose detail modal is open, joined with its rank + result, or null.
	const [detail, setDetail] = useState<
		{ horse: ParsedRosterHorse; result: RosterResult | null; rank: number } | null
	>(null);

	// Load a horse into compare with its distance/surface aptitude resolved against the
	// currently-configured course (mirrors the sim-dispatch resolution in app-v2).
	const loadHorse = useCallback((horse: ParsedRosterHorse, slot: 1 | 2) => {
		const { distanceAptitude, surfaceAptitude } = resolveCourseAptitudes(horse, courseDistanceType, courseSurface);
		onSelectHorse({ ...horse.uma, distanceAptitude, surfaceAptitude }, slot);
	}, [onSelectHorse, courseDistanceType, courseSurface]);

	const doParse = useCallback((text: string) => {
		setParseError(null);
		let json: unknown;
		try {
			json = JSON.parse(text);
		} catch (e) {
			setParseError('Could not parse JSON. Make sure you pasted the full export.');
			return;
		}
		if (!Array.isArray(json)) {
			setParseError('Expected a JSON array of trained-character objects.');
			return;
		}
		const parsed = parseRoster(json as any[], {
			surface: courseSurface,
			includeRentals,
			includeStubs,
		});
		if (parsed.horses.length === 0) {
			setParseError('No race-ready horses found after filtering. Try enabling the include toggles.');
			return;
		}
		onRosterParsed(parsed);
		setUploadOpen(false);
		setPasteText('');
	}, [courseSurface, includeRentals, includeStubs, onRosterParsed]);

	const handleFile = useCallback((e: Event) => {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => doParse(String(reader.result || ''));
		reader.onerror = () => setParseError('Could not read file.');
		reader.readAsText(file);
	}, [doParse]);

	// Join results to horses and sort. Horses without a result (e.g. a sim error)
	// are pushed to the bottom.
	const ranked = useMemo(() => {
		const byIndex = new Map<number, RosterResult>();
		for (const r of results) byIndex.set(r.index, r);
		const rows = horses.map((horse, i) => ({ horse, result: byIndex.get(i) ?? null }));
		rows.sort((a, b) => {
			if (a.result == null && b.result == null) return 0;
			if (a.result == null) return 1;
			if (b.result == null) return -1;
			const key = sortKey === 'mean' ? 'meanTime' : 'medianTime';
			return a.result[key] - b.result[key];
		});
		return rows;
	}, [horses, results, sortKey]);

	const hasResults = results.length > 0;

	return (
		<div class="v2-roster-pane">
			<div class="v2-roster-controls">
				<Button
					variant="secondary"
					icon={<Upload size={14} />}
					onClick={() => setUploadOpen(true)}
				>
					{horses.length > 0 ? `Roster: ${horses.length} horses` : 'Upload data.json'}
				</Button>

				<label class="v2-roster-samples">
					<span>Samples/horse</span>
					<input
						type="number"
						min={10}
						max={1000}
						step={10}
						value={samples}
						onInput={(e) => setSamples(Math.max(10, Math.min(1000, +(e.target as HTMLInputElement).value || 10)))}
					/>
				</label>

				{hasResults && (
					<div class="v2-roster-sort">
						<span>Sort by</span>
						<button
							type="button"
							class={sortKey === 'mean' ? 'active' : ''}
							onClick={() => setSortKey('mean')}
						>Mean</button>
						<button
							type="button"
							class={sortKey === 'median' ? 'active' : ''}
							onClick={() => setSortKey('median')}
						>Median</button>
					</div>
				)}
			</div>

			{isRunning && progress && (
				<div class="v2-roster-progress">
					<div class="v2-roster-progress-bar">
						<div
							class="v2-roster-progress-fill"
							style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }}
						/>
					</div>
					<span>{progress.done} / {progress.total} horses</span>
				</div>
			)}

			{horses.length === 0 ? (
				<div class="v2-roster-empty">
					<p>Upload your account export to rank every horse you own on the configured race.</p>
					<p class="v2-roster-empty-hint">
						The export is a JSON array of trained characters. Rentals and incomplete
						stub horses are skipped by default.
					</p>
				</div>
			) : (
				<div class="v2-roster-table-wrap">
					<table class="v2-roster-table">
						<thead>
							<tr>
								<th class="v2-roster-rank">#</th>
								<th class="v2-roster-name">Horse</th>
								<th class="v2-roster-style">Style</th>
								<th class="v2-roster-num" title="Distance aptitude for the configured course">Dist</th>
								<th class="v2-roster-num">Mean</th>
								<th class="v2-roster-num">Median</th>
								<th class="v2-roster-num">Best</th>
								<th class="v2-roster-num">±σ</th>
								<th class="v2-roster-num" title="Percentage of runs with a full last spurt">Spurt</th>
								<th class="v2-roster-num" title="Equipped skills">Skills</th>
								<th class="v2-roster-num" title="Total SP cost of equipped skills">SP</th>
								<th class="v2-roster-load-col">Load</th>
							</tr>
						</thead>
						<tbody>
							{ranked.map(({ horse, result }, i) => {
								const distApt = resolveCourseAptitudes(horse, courseDistanceType, courseSurface).distanceAptitude;
								const skillCount = horse.uma.skills.length;
								const sp = computeSkillSp(horse.uma.skills);
								return (
								<tr
									key={horse.trainedCharaId || i}
									class="v2-roster-row"
									onClick={() => setDetail({ horse, result, rank: i + 1 })}
									title="View stats, skills & metrics"
								>
									<td class="v2-roster-rank">{result ? i + 1 : '—'}</td>
									<td class="v2-roster-name">
										<img
											class="v2-roster-icon"
											src={horse.iconUrl}
											alt=""
											loading="lazy"
											onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
										/>
										<span>{horse.name}</span>
									</td>
									<td class="v2-roster-style">{STRATEGY_LABEL[horse.uma.strategy] ?? horse.uma.strategy}</td>
									<td class="v2-roster-num"><b class={aptClass(distApt)}>{distApt}</b></td>
									<td class="v2-roster-num v2-roster-mean">{result ? fmtTime(result.meanTime) : '—'}</td>
									<td class="v2-roster-num">{result ? fmtTime(result.medianTime) : '—'}</td>
									<td class="v2-roster-num">{result ? fmtTime(result.minTime) : '—'}</td>
									<td class="v2-roster-num">{result ? (result.stdTime * 1.18).toFixed(3) : '—'}</td>
									<td class="v2-roster-num">{result != null && result.fullSpurtRate != null ? result.fullSpurtRate.toFixed(0) + '%' : '—'}</td>
									<td class="v2-roster-num">{skillCount}</td>
									<td class="v2-roster-num">{sp.toLocaleString()}</td>
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

			<Modal
				isOpen={uploadOpen}
				onClose={() => setUploadOpen(false)}
				title="Upload account roster"
				size="md"
			>
				<div class="v2-roster-upload">
					<p class="v2-roster-upload-desc">
						Upload or paste your game-account export (a JSON array of trained
						characters). Every owned horse will be ranked by finish time on the
						course currently configured above.
					</p>

					<div class="v2-roster-upload-file">
						<label class="v2-roster-file-label">
							<Upload size={14} />
							<span>Choose data.json…</span>
							<input type="file" accept=".json,application/json" onChange={handleFile} />
						</label>
					</div>

					<div class="v2-roster-upload-or">— or paste —</div>

					<Textarea
						value={pasteText}
						onInput={setPasteText}
						placeholder="Paste the JSON array here…"
						rows={6}
					/>

					<div class="v2-roster-upload-opts">
						<Switch
							checked={includeRentals}
							onChange={setIncludeRentals}
							label="Include rentals (borrowed)"
						/>
						<Switch
							checked={includeStubs}
							onChange={setIncludeStubs}
							label="Include low-grade stubs"
						/>
					</div>

					{parseError && <div class="v2-roster-upload-error">{parseError}</div>}
				</div>

				<div class="v2-roster-upload-actions">
					<Button variant="secondary" onClick={() => setUploadOpen(false)}>Cancel</Button>
					<Button
						variant="primary"
						disabled={pasteText.trim().length === 0}
						onClick={() => doParse(pasteText)}
					>
						Load roster
					</Button>
				</div>
			</Modal>

			<Modal
				isOpen={detail != null}
				onClose={() => setDetail(null)}
				title={detail?.horse.name}
				size="lg"
				footer={detail && (
					<div class="v2-roster-detail-actions">
						<Button
							variant="secondary"
							onClick={() => { loadHorse(detail.horse, 1); setDetail(null); }}
						>
							Load into Uma 1
						</Button>
						<Button
							variant="secondary"
							onClick={() => { loadHorse(detail.horse, 2); setDetail(null); }}
						>
							Load into Uma 2
						</Button>
					</div>
				)}
			>
				{detail && (() => {
					const { horse, result, rank } = detail;
					const u = horse.uma;
					// Distance/surface aptitude shown for the currently-configured course
					// (not the parse-time max()), matching what the sim actually uses.
					const { distanceAptitude, surfaceAptitude } = resolveCourseAptitudes(horse, courseDistanceType, courseSurface);
					const skillSp = computeSkillSp(u.skills);
					const aptTiles = [
						{ label: 'Surface', grade: surfaceAptitude },
						{ label: 'Distance', grade: distanceAptitude },
						{ label: 'Style', grade: u.strategyAptitude },
					];
					return (
						<div class="v2-roster-detail v2-uma-panel-modal">
							<div class="v2-roster-detail-card v2-roster-detail-head">
								<img
									class="v2-roster-detail-icon"
									src={horse.iconUrl}
									alt=""
									onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
								/>
								<div class="v2-roster-detail-head-info">
									<div class="v2-roster-detail-name">{horse.name}</div>
									<div class="v2-roster-detail-sub">
										{'★'.repeat(u.starCount)} · {result ? `Rank #${rank}` : 'No result'}
										{result && <span class="v2-roster-detail-mean"> · {fmtTime(result.meanTime)} mean</span>}
									</div>
								</div>
							</div>

							{result && (
								<div class="v2-roster-detail-card">
									<div class="v2-roster-detail-section-header">Race Metrics <span class="v2-roster-detail-badge">{result.sampleCount} samples</span></div>
									<div class="v2-roster-detail-metrics">
										<div class="v2-roster-metric"><span>Mean</span><b>{fmtTime(result.meanTime)}</b></div>
										<div class="v2-roster-metric"><span>Median</span><b>{fmtTime(result.medianTime)}</b></div>
										<div class="v2-roster-metric"><span>Best</span><b>{fmtTime(result.minTime)}</b></div>
										<div class="v2-roster-metric"><span>Worst</span><b>{fmtTime(result.maxTime)}</b></div>
										<div class="v2-roster-metric"><span>±σ</span><b>{(result.stdTime * 1.18).toFixed(3)}</b></div>
										<div class="v2-roster-metric"><span>Spurt</span><b>{result.fullSpurtRate != null ? result.fullSpurtRate.toFixed(0) + '%' : '—'}</b></div>
									</div>
								</div>
							)}

							<CollapsibleSection title="Stats" defaultOpen={true}>
								<div class="v2-stats-grid">
									{STAT_ICONS.map(s => (
										<div class="v2-stat-input" key={s.key}>
											<div class="v2-stat-header">
												<img src={s.icon} alt={s.label} class="v2-stat-type-icon" />
												<span class="v2-stat-label">{s.label}</span>
											</div>
											<div class="v2-stat-value">
												<img src={statRankIconUrl(u[s.key] as number)} alt="" class="v2-stat-rank-icon" />
												<span class="v2-stat-readonly">{u[s.key] as number}</span>
											</div>
										</div>
									))}
								</div>
							</CollapsibleSection>

							<CollapsibleSection title="Aptitudes" defaultOpen={true}>
								<div class="v2-aptitudes-grid v2-roster-detail-apts-grid">
									{aptTiles.map(at => (
										<div class="v2-aptitude-row" key={at.label}>
											<span class="v2-aptitude-label">{at.label}</span>
											<img src={aptitudeRankIconUrl(at.grade)} alt={at.grade} class="v2-aptitude-rank-icon" />
										</div>
									))}
								</div>
								<div class="v2-strategy-row v2-roster-detail-style-row">
									<span class="v2-strategy-label">Style</span>
									<div class="v2-roster-detail-style-value">{STRATEGY_FULL[u.strategy] ?? u.strategy}</div>
								</div>
							</CollapsibleSection>

							<CollapsibleSection title="Skills" defaultOpen={true} badge={`${u.skills.length} · ${skillSp.toLocaleString()} SP`}>
								{u.skills.length === 0 ? (
									<div class="v2-roster-detail-empty">No skills equipped.</div>
								) : (
									<ul class="v2-roster-detail-skills">
										{u.skills.map((id) => {
											const isUnique = id === horse.uniqueSkillId;
											return (
												<li class="v2-roster-skill" key={id}>
													<img
														class={'v2-roster-skill-icon ' + getSkillRarityClass(id)}
														src={getSkillIcon(id)}
														alt=""
														onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
													/>
													<span class="v2-roster-skill-name">{getSkillName(id)}</span>
													{isUnique && <span class="v2-roster-skill-lv">Lv{u.uniqueLv}</span>}
												</li>
											);
										})}
									</ul>
								)}
							</CollapsibleSection>
						</div>
					);
				})()}
			</Modal>
		</div>
	);
}
