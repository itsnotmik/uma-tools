/**
 * Spark (succession factor) resolution and aggregation for the Sparks viewer.
 *
 * Factor names/types/stars come from factor_data.json, generated from the Global
 * master.mdb (succession_factor joined with text_data category 147). Regenerate with:
 *
 *   sqlite3 docs/master.mdb "SELECT json_group_object(CAST(sf.factor_id AS TEXT),
 *     json_object('name', td.text, 'type', sf.factor_type, 'rarity', sf.rarity))
 *     FROM succession_factor sf
 *     JOIN text_data td ON td.category=147 AND td.\"index\"=sf.factor_id;"
 *
 * Do NOT derive type/stars arithmetically from the id — the table has at least one
 * id (4000102) that violates the group*100+rarity encoding; always read the columns.
 *
 * factor_type: 1 = stat (blue), 2 = aptitude (pink), 3 = character/unique (green),
 * 4 = skill (white), 5 = race (white), 6 = scenario (white), 7 = event bonus.
 *
 * Copyright (c) 2026 TheCing (https://github.com/TheCing/uma-tools)
 * Licensed under GPL-3.0-or-later
 */

import factordata from '../factor_data.json';

import type { ParsedRosterHorse } from './roster-parser';

export interface SparkDef {
	name: string;
	type: number;
	rarity: number;
}

const FACTOR_TABLE = factordata as Record<string, SparkDef>;

/** A resolved spark: factor id + display name, category type, and star level. */
export interface Spark {
	id: number;
	name: string;
	type: number;
	stars: number;
}

/** Resolve a factor id to a displayable spark. Unknown ids (data newer than
 *  factor_data.json) degrade to a labeled placeholder with stars from the id's
 *  last digit when it looks like a star level (1-3). */
export function resolveSpark(id: number): Spark {
	const def = FACTOR_TABLE[String(id)];
	if (def) return { id, name: def.name, type: def.type, stars: def.rarity };
	const last = id % 10;
	return { id, name: `Unknown Spark (${id})`, type: 0, stars: last >= 1 && last <= 3 ? last : 1 };
}

/** Spark types displayed as white sparks in-game (skill + race + scenario). */
export function isWhite(s: Spark): boolean {
	return s.type === 4 || s.type === 5 || s.type === 6;
}

/** Aggregated view of one runner's sparks, grouped the way the game displays them. */
export interface SparkSummary {
	blue: Spark | null;
	pink: Spark | null;
	green: Spark[];
	whiteSkill: Spark[];
	whiteRace: Spark[];
	whiteScenario: Spark[];
	other: Spark[];
	/** Count of white sparks (skill + race + scenario). */
	whiteCount: number;
	/** Sum of stars across white sparks. */
	whiteStars: number;
	/** Sum of stars across all sparks. */
	totalStars: number;
}

export function summarizeSparks(factorIdList: number[]): SparkSummary {
	const summary: SparkSummary = {
		blue: null, pink: null, green: [],
		whiteSkill: [], whiteRace: [], whiteScenario: [], other: [],
		whiteCount: 0, whiteStars: 0, totalStars: 0,
	};
	for (const id of factorIdList) {
		const s = resolveSpark(id);
		summary.totalStars += s.stars;
		switch (s.type) {
			case 1: summary.blue = s; break;
			case 2: summary.pink = s; break;
			case 3: summary.green.push(s); break;
			case 4: summary.whiteSkill.push(s); break;
			case 5: summary.whiteRace.push(s); break;
			case 6: summary.whiteScenario.push(s); break;
			default: summary.other.push(s); break;
		}
		if (isWhite(s)) {
			summary.whiteCount++;
			summary.whiteStars += s.stars;
		}
	}
	// Highest stars first within each group, then by name for stable display.
	const byStars = (a: Spark, b: Spark) => b.stars - a.stars || a.name.localeCompare(b.name);
	summary.green.sort(byStars);
	summary.whiteSkill.sort(byStars);
	summary.whiteRace.sort(byStars);
	summary.whiteScenario.sort(byStars);
	summary.other.sort(byStars);
	return summary;
}

/** All factor ids in a horse's inheritance tree: self + 2 parents + 4 grandparents. */
export function treeFactorIds(horse: ParsedRosterHorse): number[] {
	const ids = horse.factors.slice();
	for (const s of horse.succession) ids.push(...s.factors);
	return ids;
}

/** For a set of factor ids, the star level of a named spark (max across copies; 0 if absent).
 *  Sparks are matched by NAME because each star level is a distinct factor id. */
export function starsOfSpark(factorIdList: number[], sparkName: string): number {
	let best = 0;
	for (const id of factorIdList) {
		const s = resolveSpark(id);
		if (s.name === sparkName && s.stars > best) best = s.stars;
	}
	return best;
}

/** One entry in the searchable index of sparks present in the roster. */
export interface SparkIndexEntry {
	name: string;
	type: number;
	/** How many horses have this spark (within the chosen scope). */
	umaCount: number;
	/** Best star level seen anywhere in the roster. */
	maxStars: number;
}

/** Build the search index over every spark appearing in the roster.
 *  Scope is each horse's own sparks, or the full tree when includeTree is set. */
export function buildSparkIndex(horses: ParsedRosterHorse[], includeTree: boolean): SparkIndexEntry[] {
	const byName = new Map<string, SparkIndexEntry>();
	for (const horse of horses) {
		const ids = includeTree ? treeFactorIds(horse) : horse.factors;
		const seen = new Set<string>();
		for (const id of ids) {
			const s = resolveSpark(id);
			let entry = byName.get(s.name);
			if (!entry) {
				entry = { name: s.name, type: s.type, umaCount: 0, maxStars: 0 };
				byName.set(s.name, entry);
			}
			if (!seen.has(s.name)) {
				entry.umaCount++;
				seen.add(s.name);
			}
			if (s.stars > entry.maxStars) entry.maxStars = s.stars;
		}
	}
	return Array.from(byName.values());
}
