/**
 * Roster Upload Modal (V2)
 *
 * Shared upload/paste dialog for the game-account export (data.json), used by
 * both Roster mode (ranking) and Sparks mode (factor viewer). Extracted from
 * roster-pane.tsx unchanged: file picker + paste box + rental/stub filters,
 * parsed via parseRoster into the shared roster state.
 *
 * Copyright (c) 2026 TheCing (https://github.com/TheCing/uma-tools)
 * Licensed under GPL-3.0-or-later
 */

import { h } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import { Upload } from 'lucide-react';

import { Modal, Button, Textarea, Switch } from './components';
import { parseRoster, type RosterParseResult } from './roster-parser';

interface RosterUploadModalProps {
	isOpen: boolean;
	onClose: () => void;
	/** Course surface of the currently-selected course (1=Turf, 2=Dirt) — re-parses aptitudes on upload. */
	courseSurface: 1 | 2;
	/** Called with the freshly-parsed roster when the user uploads/pastes. */
	onRosterParsed: (parsed: RosterParseResult) => void;
	/** Intro line above the file picker (defaults to the roster-ranking wording). */
	description?: string;
}

export function RosterUploadModal({
	isOpen,
	onClose,
	courseSurface,
	onRosterParsed,
	description,
}: RosterUploadModalProps) {
	const [pasteText, setPasteText] = useState('');
	const [parseError, setParseError] = useState<string | null>(null);
	const [includeRentals, setIncludeRentals] = useState(false);
	const [includeStubs, setIncludeStubs] = useState(false);

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
		onClose();
		setPasteText('');
	}, [courseSurface, includeRentals, includeStubs, onRosterParsed, onClose]);

	const handleFile = useCallback((e: Event) => {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => doParse(String(reader.result || ''));
		reader.onerror = () => setParseError('Could not read file.');
		reader.readAsText(file);
	}, [doParse]);

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			title="Upload account roster"
			size="md"
		>
			<div class="v2-roster-upload">
				<p class="v2-roster-upload-desc">
					{description ?? 'Upload or paste your game-account export (a JSON array of trained ' +
						'characters). Every owned horse will be ranked by finish time on the ' +
						'course currently configured above.'}
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
				<Button variant="secondary" onClick={onClose}>Cancel</Button>
				<Button
					variant="primary"
					disabled={pasteText.trim().length === 0}
					onClick={() => doParse(pasteText)}
				>
					Load roster
				</Button>
			</div>
		</Modal>
	);
}
