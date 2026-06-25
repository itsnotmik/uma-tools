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
import {
	parseRoster,
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
	sampleCount: number;
}

interface RosterPaneProps {
	/** Parsed roster horses (filtered), in the order they were submitted to the worker. */
	horses: ParsedRosterHorse[];
	/** Per-horse finish-time results from the worker (joined by `index`). */
	results: RosterResult[];
	/** Course surface of the currently-selected course (1=Turf, 2=Dirt) — re-parses aptitudes on upload. */
	courseSurface: 1 | 2;
	/** Whether a run is in progress. */
	isRunning: boolean;
	/** Progress {done,total} during a run, or null. */
	progress: { done: number; total: number } | null;
	/** Sample count per horse. */
	samples: number;
	setSamples: (n: number) => void;
	/** Called with the freshly-parsed roster when the user uploads/pastes. */
	onRosterParsed: (parsed: RosterParseResult) => void;
	/** Load a horse into Uma 1 and switch to compare mode. */
	onSelectHorse: (uma: UmaState) => void;
}

const STRATEGY_LABEL: Record<string, string> = {
	Nige: 'Front',
	Senkou: 'Pace',
	Sasi: 'Late',
	Oikomi: 'End',
	Oonige: 'Front (Oo)',
};

function fmtTime(t: number): string {
	if (!isFinite(t)) return '—';
	return t.toFixed(3) + 's';
}

export function RosterPane({
	horses,
	results,
	courseSurface,
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
								<th>Style</th>
								<th class="v2-roster-num">Mean</th>
								<th class="v2-roster-num">Median</th>
								<th class="v2-roster-num">Best</th>
								<th class="v2-roster-num">±σ</th>
							</tr>
						</thead>
						<tbody>
							{ranked.map(({ horse, result }, i) => (
								<tr
									key={horse.trainedCharaId || i}
									class="v2-roster-row"
									onClick={() => onSelectHorse(horse.uma)}
									title="Load into Uma 1 for detailed comparison"
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
									<td>{STRATEGY_LABEL[horse.uma.strategy] ?? horse.uma.strategy}</td>
									<td class="v2-roster-num v2-roster-mean">{result ? fmtTime(result.meanTime) : '—'}</td>
									<td class="v2-roster-num">{result ? fmtTime(result.medianTime) : '—'}</td>
									<td class="v2-roster-num">{result ? fmtTime(result.minTime) : '—'}</td>
									<td class="v2-roster-num">{result ? result.stdTime.toFixed(3) : '—'}</td>
								</tr>
							))}
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
		</div>
	);
}
