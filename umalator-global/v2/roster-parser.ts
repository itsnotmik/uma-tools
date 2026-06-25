/**
 * Roster Parser for V2
 *
 * Converts a game-account export (a flat JSON array of "trained character"
 * objects, e.g. data.json) into V2 UmaState objects plus display metadata,
 * so the whole roster can be simulated and ranked on the configured race.
 *
 * This is a roster-specific adapter. The existing components/gameExportParser.ts
 * expects a single { chara_info: {...} } wrapper and reads race_running_style /
 * motivation, whereas the account export entries are flat and use running_style
 * (with no live motivation field). We reuse the mapping logic but operate on the
 * flat array entry shape.
 *
 * Copyright (c) 2026 TheCing (https://github.com/TheCing/uma-tools)
 * Licensed under GPL-3.0-or-later
 */

import type { UmaState } from './uma-panel';
import { defaultUmaState } from './uma-panel';
import umas from '../umas.json';
import icons from '../../icons.json';
import skillmeta from '../../skill_meta.json';
import skilldata from '../skill_data.json';

// Game aptitude grades (1-8) -> letter grades used by the simulator.
const APT_MAP: Record<number, UmaState['distanceAptitude']> = {
	1: 'G', 2: 'F', 3: 'E', 4: 'D', 5: 'C', 6: 'B', 7: 'A', 8: 'S',
};

// running_style (1-4) -> simulator strategy string.
const STRATEGY_MAP: Record<number, UmaState['strategy']> = {
	1: 'Nige', 2: 'Senkou', 3: 'Sasi', 4: 'Oikomi',
};

// running_style -> the matching proper_running_style_* aptitude key in the export.
const STRATEGY_PROPER_KEYS: Record<number, string> = {
	1: 'proper_running_style_nige',
	2: 'proper_running_style_senko',
	3: 'proper_running_style_sashi',
	4: 'proper_running_style_oikomi',
};

const skillMetaTable = skillmeta as Record<string, { groupId?: string; iconId?: string }>;
const skillDataTable = skilldata as Record<string, unknown>;
const umasTable = umas as Record<string, { name?: string[]; outfits?: Record<string, unknown> }>;

/** A single entry from the account export array (only the fields we use). */
export interface RosterExportEntry {
	trained_chara_id?: number;
	card_id?: number;
	speed?: number;
	stamina?: number;
	power?: number;
	wiz?: number;
	guts?: number;
	running_style?: number;
	rarity?: number;
	rank?: number;
	chara_grade?: number;
	use_type?: number;
	proper_ground_turf?: number;
	proper_ground_dirt?: number;
	proper_distance_short?: number;
	proper_distance_mile?: number;
	proper_distance_middle?: number;
	proper_distance_long?: number;
	proper_running_style_nige?: number;
	proper_running_style_senko?: number;
	proper_running_style_sashi?: number;
	proper_running_style_oikomi?: number;
	skill_array?: { skill_id: number | string; level?: number }[];
	[key: string]: unknown;
}

/** A parsed roster horse: the simulator-ready UmaState plus display metadata. */
export interface ParsedRosterHorse {
	uma: UmaState;
	trainedCharaId: number;
	cardId: number;
	name: string;
	iconUrl: string;
	rank: number;
	charaGrade: number;
	useType: number;
	/** The equipped unique skill id (empty if none), so the UI can label its level. */
	uniqueSkillId: string;
	/** Raw distance aptitude grades (game 1-8) for course-matched resolution. */
	rawDistanceGrades: { short?: number; mile?: number; middle?: number; long?: number };
	/** Raw ground aptitude grades (game 1-8) for surface resolution. */
	rawGroundGrades: { turf?: number; dirt?: number };
}

export interface RosterParseOptions {
	/** Course surface (1 = Turf, 2 = Dirt). Selects which ground aptitude to use. */
	surface?: 1 | 2;
	/** Include rentals/borrowed horses (use_type === 1). Default false. */
	includeRentals?: boolean;
	/** Include low-grade incomplete "stub" entries. Default false. */
	includeStubs?: boolean;
}

export interface RosterParseResult {
	horses: ParsedRosterHorse[];
	total: number;
	skippedRentals: number;
	skippedStubs: number;
	skippedInvalid: number;
}

function clampAptitude(v: number | undefined): UmaState['distanceAptitude'] {
	return APT_MAP[v as number] ?? 'A';
}

/**
 * Resolve a horse's distance + surface aptitude for a SPECIFIC course, using the
 * course's distanceType (1=Sprint, 2=Mile, 3=Mid, 4=Long) and surface (1=Turf, 2=Dirt).
 *
 * The parser stores raw 1-8 grades for every distance/ground so the correct aptitude
 * can be picked against whatever course is configured at sim time (no re-parse needed).
 * clampAptitude(undefined) -> 'A', so a missing grade degrades exactly as the old
 * parse-time default did.
 */
export function resolveCourseAptitudes(
	horse: ParsedRosterHorse,
	distanceType: number,
	surface: number,
): { distanceAptitude: UmaState['distanceAptitude']; surfaceAptitude: UmaState['surfaceAptitude'] } {
	const d = horse.rawDistanceGrades;
	const distByType: Record<number, number | undefined> = { 1: d.short, 2: d.mile, 3: d.middle, 4: d.long };
	const distGrade = distByType[distanceType]
		?? Math.max(d.short ?? 1, d.mile ?? 1, d.middle ?? 1, d.long ?? 1);
	const g = horse.rawGroundGrades;
	return {
		distanceAptitude: clampAptitude(distGrade),
		surfaceAptitude: clampAptitude(surface === 2 ? g.dirt : g.turf),
	};
}

/**
 * A "stub" is an abandoned/incomplete training run: tiny stats, barely raced.
 * These are noise at the bottom of any ranking, so they're filtered by default.
 * Heuristic: very low overall rank or low chara_grade.
 */
function isStub(entry: RosterExportEntry): boolean {
	const grade = entry.chara_grade ?? 99;
	const rank = entry.rank ?? 99;
	return grade <= 3 || rank <= 5;
}

/**
 * Convert one export entry to a UmaState + display metadata.
 * Returns null if the entry is missing required fields.
 */
export function parseRosterEntry(
	entry: RosterExportEntry,
	surface: 1 | 2 = 1,
): ParsedRosterHorse | null {
	if (entry == null || typeof entry !== 'object') return null;
	if (typeof entry.speed !== 'number' || typeof entry.wiz !== 'number') return null;
	if (!Array.isArray(entry.skill_array)) return null;
	if (entry.card_id == null) return null;

	const outfitId = String(entry.card_id);
	const starCount = (typeof entry.rarity === 'number' ? entry.rarity : 3) as UmaState['starCount'];

	const strategy = STRATEGY_MAP[entry.running_style as number] ?? 'Senkou';

	// Surface aptitude follows the configured course's surface.
	const groundApt = surface === 2 ? entry.proper_ground_dirt : entry.proper_ground_turf;
	const surfaceAptitude = clampAptitude(groundApt);

	// Distance aptitude: best of the four distance grades.
	const distanceAptitude = clampAptitude(Math.max(
		entry.proper_distance_short ?? 1,
		entry.proper_distance_mile ?? 1,
		entry.proper_distance_middle ?? 1,
		entry.proper_distance_long ?? 1,
	));

	// Strategy aptitude: the grade matching the equipped running style.
	const stratKey = STRATEGY_PROPER_KEYS[entry.running_style as number] ?? 'proper_running_style_senko';
	const strategyAptitude = clampAptitude(entry[stratKey] as number | undefined);

	// Equipped skills: keep only IDs known to skill_meta.json (groupId lookups
	// downstream throw on unknown IDs). Track the unique skill's level.
	const expectedUniqueId = uniqueSkillForUma(outfitId, starCount);
	let uniqueLv = 1;
	let uniqueSkillId = '';
	const skills: string[] = [];
	for (const s of entry.skill_array) {
		const id = String(s.skill_id);
		if (!(id in skillMetaTable)) continue;
		skills.push(id);
		if (id === expectedUniqueId) {
			uniqueSkillId = id;
			if (typeof s.level === 'number' && s.level > 1) uniqueLv = s.level;
		}
	}

	const uma: UmaState = {
		...defaultUmaState,
		outfitId,
		starCount,
		uniqueLv,
		speed: entry.speed,
		stamina: entry.stamina ?? 0,
		power: entry.power ?? 0,
		guts: entry.guts ?? 0,
		wisdom: entry.wiz,
		strategy,
		distanceAptitude,
		surfaceAptitude,
		strategyAptitude,
		mood: 2,
		skills,
		forcedSkillPositions: {},
	};

	const charaId = outfitId.slice(0, 4);
	const charaEntry = umasTable[charaId];
	const name = charaEntry?.name?.[1] || charaEntry?.name?.[0] || `Uma ${charaId}`;
	// Prefer the app's icon manifest (icons.json), keyed by outfit id; fall back to
	// the conventional trained-icon path for outfits not in the manifest.
	const iconUrl = (icons as Record<string, string>)[outfitId]
		|| `/uma-tools/icons/chara/trained_chr_icon_${charaId}_${outfitId}_02.png`;

	return {
		uma,
		trainedCharaId: entry.trained_chara_id ?? 0,
		cardId: entry.card_id,
		name,
		iconUrl,
		rank: entry.rank ?? 0,
		charaGrade: entry.chara_grade ?? 0,
		useType: entry.use_type ?? 0,
		uniqueSkillId,
		rawDistanceGrades: {
			short: entry.proper_distance_short,
			mile: entry.proper_distance_mile,
			middle: entry.proper_distance_middle,
			long: entry.proper_distance_long,
		},
		rawGroundGrades: {
			turf: entry.proper_ground_turf,
			dirt: entry.proper_ground_dirt,
		},
	};
}

/**
 * Parse a full account export array into ranked-ready roster horses,
 * applying the default rental/stub filters (overridable).
 */
export function parseRoster(
	entries: RosterExportEntry[],
	opts: RosterParseOptions = {},
): RosterParseResult {
	const surface = opts.surface ?? 1;
	const includeRentals = opts.includeRentals ?? false;
	const includeStubs = opts.includeStubs ?? false;

	const horses: ParsedRosterHorse[] = [];
	let skippedRentals = 0;
	let skippedStubs = 0;
	let skippedInvalid = 0;

	for (const entry of entries) {
		if (!includeRentals && entry?.use_type === 1) {
			skippedRentals++;
			continue;
		}
		if (!includeStubs && isStub(entry)) {
			skippedStubs++;
			continue;
		}
		const parsed = parseRosterEntry(entry, surface);
		if (parsed == null) {
			skippedInvalid++;
			continue;
		}
		horses.push(parsed);
	}

	return {
		horses,
		total: entries.length,
		skippedRentals,
		skippedStubs,
		skippedInvalid,
	};
}

/**
 * Derive the unique skill ID for an outfit (mirrors uma-panel.tsx). Used to know
 * which equipped skill the export's per-skill level applies to.
 */
function uniqueSkillForUma(oid: string, starCount: number = 3): string {
	if (oid.length === 0) return '';
	const i = +oid.slice(1, -2);
	const v = +oid.slice(-2);
	const sid = (10000 * (1 + 9 * +(starCount > 2)) + 10000 * (v - 1) + i * 10 + 1).toString();
	return sid in skillDataTable ? sid : '';
}
