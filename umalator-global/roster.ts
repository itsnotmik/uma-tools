/**
 * Roster simulation
 *
 * Sibling to compare.ts. Where runComparison() returns the バ身 (bashin)
 * *difference* between two horses, runRoster() simulates each horse on its own
 * and returns ABSOLUTE finish-time statistics (mean / median / min / max / std)
 * so a whole account's worth of horses can be ranked on a single configured race.
 *
 * Each horse is simulated in isolation (no opposing umas) — the correct model for
 * "rank my horses by their own speed on this track". Position keep is still
 * modelled against a default pacer (as in compare.ts) so non-Nige strategies
 * pace realistically. The finish time of a sample is solver.accumulatetime.t at
 * the moment solver.pos >= course.distance.
 *
 * Copyright (c) 2026 TheCing (https://github.com/TheCing/uma-tools)
 * Licensed under GPL-3.0-or-later
 */

import { CourseData } from '../uma-skill-tools/CourseData';
import { RaceParameters } from '../uma-skill-tools/RaceParameters';
import { RaceSolver, PosKeepMode, Perspective } from '../uma-skill-tools/RaceSolver';
import { RaceSolverBuilder, buildBaseStats, buildAdjustedStats } from '../uma-skill-tools/RaceSolverBuilder';
import { Rule30CARng } from '../uma-skill-tools/Random';

import { HorseState, uniqueSkillForUma } from '../components/HorseDefTypes';

import skilldata from '../uma-skill-tools/data/skill_data.json';

export interface RosterRunOptions {
	seed: number;
	posKeepMode?: PosKeepMode;
	pacemakerCount?: number;
	skillWisdomCheck?: boolean;
	rushedKakari?: boolean;
	competeFight?: boolean;
	leadCompetition?: boolean;
	laneMovement?: boolean;
	duelingRates?: any;
}

export interface RosterHorseResult {
	/** Index into the input `umas` array, for joining back to display metadata. */
	index: number;
	/** Mean finish time in seconds (primary ranking key — lower is better). */
	meanTime: number;
	/** Median finish time in seconds (consistency read). */
	medianTime: number;
	/** Best-case (fastest) finish time. */
	minTime: number;
	/** Worst-case (slowest) finish time. */
	maxTime: number;
	/** Standard deviation of finish times (spread / consistency). */
	stdTime: number;
	/** Percentage of samples that achieved a full last spurt (matches compare's fullSpurtRate). */
	fullSpurtRate: number;
	sampleCount: number;
}

/**
 * Build a configured RaceSolverBuilder for a single horse, mirroring the
 * stat/skill/option setup of compare.ts but for one uma with only its own
 * (Perspective.Self) skills.
 */
function buildHorse(
	nsamples: number,
	course: CourseData,
	racedef: RaceParameters,
	uma: HorseState,
	options: RosterRunOptions,
) {
	const builder = new RaceSolverBuilder(nsamples)
		.seed(options.seed)
		.course(course)
		.ground(racedef.groundCondition)
		.weather(racedef.weather)
		.season(racedef.season)
		.time(racedef.time)
		.posKeepMode(options.posKeepMode ?? PosKeepMode.Approximate)
		.mode('compare');  // 'compare' mode enables GameHpPolicy (realistic stamina)

	if (racedef.orderRange != null) {
		builder.order(racedef.orderRange[0], racedef.orderRange[1]).numUmas(racedef.numUmas);
	}

	if (options.skillWisdomCheck === false) builder.skillWisdomCheck(false);
	if (options.rushedKakari === false) builder.rushedKakari(false);
	if (options.competeFight !== undefined) builder.competeFight(options.competeFight);
	if (options.duelingRates) builder.duelingRates(options.duelingRates);
	if (options.leadCompetition !== undefined) builder.leadCompetition(options.leadCompetition);
	if (options.laneMovement !== undefined) builder.laneMovement(options.laneMovement);

	// `.toJS()` deep-converts the Immutable Record; the resulting `skills` is
	// loosely typed (as in compare.ts), so treat the plain object as `any`.
	const umaJs: any = uma.update('skills', sk => Array.from(sk.values())).toJS();
	builder.horse(umaJs);

	// Apply the equipped unique skill's level only to the unique skill (as compare.ts does);
	// every other skill is level 1. Skills are added Perspective.Self only (single horse).
	const uniqueId = uniqueSkillForUma(uma.outfitId, uma.starCount);
	umaJs.skills.forEach((id: string) => {
		const lv = id === uniqueId ? uma.uniqueLv : 1;
		const forcedPos = uma.forcedSkillPositions.get(id);
		if (forcedPos != null) {
			builder.addSkillAtPosition(id, forcedPos, Perspective.Self, undefined, lv);
		} else {
			builder.addSkill(id, Perspective.Self, undefined, undefined, lv);
		}
	});

	if (!CC_GLOBAL) {
		builder.withAsiwotameru().withStaminaSyoubu();
	}

	let pacerHorse = null;
	if ((options.posKeepMode ?? PosKeepMode.Approximate) === PosKeepMode.Approximate) {
		pacerHorse = builder.useDefaultPacer(true);
	}

	return { builder, pacerHorse };
}

/** Sample a single horse `nsamples` times and return its finish-time stats. */
function simulateHorse(
	nsamples: number,
	course: CourseData,
	racedef: RaceParameters,
	uma: HorseState,
	options: RosterRunOptions,
): { meanTime: number; medianTime: number; minTime: number; maxTime: number; stdTime: number; fullSpurtRate: number; sampleCount: number } {
	const { builder, pacerHorse } = buildHorse(nsamples, course, racedef, uma, options);
	const gen = builder.build();
	const pacemakerCount = options.pacemakerCount ?? 1;
	const basePacerRng = new Rule30CARng(options.seed + 1);

	const times: number[] = [];
	let fullSpurtCount = 0;

	for (let i = 0; i < nsamples; ++i) {
		const pacers: (RaceSolver | null)[] = [];
		for (let j = 0; j < pacemakerCount; ++j) {
			const pacerRng = new Rule30CARng(basePacerRng.int32());
			pacers.push(pacerHorse != null ? builder.buildPacer(pacerHorse, i, pacerRng) : null);
		}
		const pacer = pacers.length > 0 ? pacers[0] : null;

		const s = gen.next().value as RaceSolver;

		// The horse races on its own; pacers exist only to drive position keep.
		s.initUmas([...pacers.filter((p): p is RaceSolver => p != null)]);
		pacers.forEach(p => {
			p?.initUmas([s, ...pacers.filter(p2 => p2 !== p && p2 != null) as RaceSolver[]]);
		});

		while (s.pos < course.distance) {
			if (pacer) {
				const currentPacer = pacer.getPacer();
				pacer.umas.forEach(u => u.updatePacer(currentPacer));
			}
			for (let j = 0; j < pacemakerCount; j++) {
				const p = j < pacers.length ? pacers[j] : null;
				if (!p || p.pos >= course.distance) continue;
				p.step(1 / 15);
			}
			s.step(1 / 15);
		}
		// Read full-spurt before cleanup (set during the race in updateLastSpurtState),
		// mirroring compare.ts's fullSpurtRate.
		if (s.fullSpurt) fullSpurtCount++;

		s.cleanup();

		times.push(s.accumulatetime.t);
	}

	times.sort((a, b) => a - b);
	const n = times.length;
	const mean = times.reduce((a, b) => a + b, 0) / n;
	const mid = Math.floor(n / 2);
	const median = n % 2 === 0 ? (times[mid - 1] + times[mid]) / 2 : times[mid];
	const variance = times.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;

	return {
		meanTime: mean,
		medianTime: median,
		minTime: times[0],
		maxTime: times[n - 1],
		stdTime: Math.sqrt(variance),
		fullSpurtRate: n > 0 ? (fullSpurtCount / n) * 100 : 0,
		sampleCount: n,
	};
}

/**
 * Simulate a whole roster on one course and return per-horse finish-time stats.
 * `onProgress(done, total)` is called after each horse, so the worker can stream
 * progress to the UI for long runs.
 */
export function runRoster(
	nsamples: number,
	course: CourseData,
	racedef: RaceParameters,
	umas: HorseState[],
	options: RosterRunOptions,
	onProgress?: (done: number, total: number) => void,
): RosterHorseResult[] {
	const results: RosterHorseResult[] = [];

	for (let index = 0; index < umas.length; ++index) {
		const uma = umas[index];
		try {
			const stats = simulateHorse(nsamples, course, racedef, uma, options);
			results.push({ index, ...stats });
		} catch (err) {
			// A single bad horse (e.g. an unexpected skill/aptitude combination) shouldn't
			// abort the whole roster. Skip it and keep going.
			console.error(`[roster] horse index ${index} failed:`, err);
		}
		if (onProgress) onProgress(index + 1, umas.length);
	}

	return results;
}
