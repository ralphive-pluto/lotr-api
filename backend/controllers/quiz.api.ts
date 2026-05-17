import { Request, Response, NextFunction } from 'express';
import { nanoid } from 'nanoid';

import { QuoteModel } from '../models/quote.model';
import { CharacterModel } from '../models/character.model';
import { MovieModel } from '../models/movie.model';
import { HttpCode } from '../helpers/constants';

type Category = 'who-said-it' | 'quote-movie' | 'character-trait';

interface QuizQuestion {
	id: string;
	category: Category;
	prompt: string;
	options: string[];
	answerIndex: number;
	source: { label: string; wikiUrl?: string };
}

// 4 / 3 / 3 mix per round, shuffled per request so the order varies.
const CATEGORY_PLAN: Category[] = [
	'who-said-it',
	'who-said-it',
	'who-said-it',
	'who-said-it',
	'quote-movie',
	'quote-movie',
	'quote-movie',
	'character-trait',
	'character-trait',
	'character-trait'
];

const BLANKS = [null, '', 'NaN'];

// Some seed fields arrive as the float NaN (CSV → BSON coercion) which JSON
// stringifies to null and slips through Mongo's $nin string filters. Treat
// any non-string or sentinel value as invalid before it becomes user-facing.
function isUsable(v: unknown): v is string {
	if (typeof v !== 'string') return false;
	const t = v.trim();
	if (!t || t === 'NaN') return false;
	return true;
}

function shuffle<T>(arr: T[]): T[] {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

function buildOptions(correct: string, distractors: string[]): { options: string[]; answerIndex: number } {
	const all = shuffle([correct, ...distractors]);
	return { options: all, answerIndex: all.indexOf(correct) };
}

// Quotes returned via aggregate skip the schema getter that trims whitespace,
// so do it manually here to keep prompt output clean.
function cleanDialog(raw: string): string {
	return (raw || '').replace(/\s\s+/g, ' ').trim();
}

async function makeWhoSaidIt(): Promise<QuizQuestion | null> {
	const quotes: any[] = await QuoteModel.aggregate([
		{ $match: { character: { $exists: true, $ne: null }, dialog: { $exists: true, $ne: '' } } },
		{ $sample: { size: 1 } },
		{ $lookup: { from: 'characters', localField: 'character', foreignField: '_id', as: 'character' } },
		{ $unwind: '$character' },
		{ $match: { 'character.name': { $exists: true, $ne: '' } } }
	]);
	if (!quotes.length) return null;
	const quote = quotes[0];
	const correct = quote.character;
	if (!isUsable(correct.name)) return null;

	// Oversample, then filter in JS so seed-data NaN/null values can't leak.
	const pool: any[] = await CharacterModel.aggregate([
		{ $match: { _id: { $ne: correct._id }, name: { $exists: true, $nin: BLANKS } } },
		{ $sample: { size: 12 } }
	]);
	const seen = new Set<string>([correct.name]);
	const distractorNames: string[] = [];
	for (const c of pool) {
		if (isUsable(c.name) && !seen.has(c.name)) {
			seen.add(c.name);
			distractorNames.push(c.name);
			if (distractorNames.length === 3) break;
		}
	}
	if (distractorNames.length < 3) return null;

	const { options, answerIndex } = buildOptions(correct.name, distractorNames);
	return {
		id: nanoid(),
		category: 'who-said-it',
		prompt: `Who spoke these words? "${cleanDialog(quote.dialog)}"`,
		options,
		answerIndex,
		source: {
			label: correct.name,
			...(correct.wikiUrl ? { wikiUrl: correct.wikiUrl } : {})
		}
	};
}

async function makeQuoteMovie(): Promise<QuizQuestion | null> {
	const quotes: any[] = await QuoteModel.aggregate([
		{ $match: { dialog: { $exists: true, $ne: '' } } },
		{ $sample: { size: 1 } },
		{ $lookup: { from: 'movies', localField: 'movie', foreignField: '_id', as: 'movie' } },
		{ $unwind: '$movie' }
	]);
	if (!quotes.length) return null;
	const quote = quotes[0];
	const correct = quote.movie;
	if (!isUsable(correct.name)) return null;

	const pool: any[] = await MovieModel.aggregate([
		{ $match: { _id: { $ne: correct._id }, name: { $exists: true, $ne: '' } } },
		{ $sample: { size: 12 } }
	]);
	const seen = new Set<string>([correct.name]);
	const distractorNames: string[] = [];
	for (const m of pool) {
		if (isUsable(m.name) && !seen.has(m.name)) {
			seen.add(m.name);
			distractorNames.push(m.name);
			if (distractorNames.length === 3) break;
		}
	}
	if (distractorNames.length < 3) return null;

	const { options, answerIndex } = buildOptions(correct.name, distractorNames);
	return {
		id: nanoid(),
		category: 'quote-movie',
		prompt: `Which film features this line? "${cleanDialog(quote.dialog)}"`,
		options,
		answerIndex,
		source: { label: correct.name }
	};
}

async function makeCharacterTrait(): Promise<QuizQuestion | null> {
	const useRealm = Math.random() < 0.5;
	const field = useRealm ? 'realm' : 'race';

	// Oversample so JS-side filtering on NaN/null values still leaves a candidate.
	const candidates: any[] = await CharacterModel.aggregate([
		{
			$match: {
				[field]: { $exists: true, $nin: BLANKS },
				name: { $exists: true, $nin: BLANKS }
			}
		},
		{ $sample: { size: 10 } }
	]);
	const character = candidates.find((c) => isUsable(c[field]) && isUsable(c.name));
	if (!character) return null;
	const correctTrait: string = character[field];

	// Oversample so de-duping by trait value still leaves us with 3 unique distractors.
	const pool: any[] = await CharacterModel.aggregate([
		{
			$match: {
				_id: { $ne: character._id },
				[field]: { $exists: true, $nin: [...BLANKS, correctTrait] }
			}
		},
		{ $sample: { size: 30 } }
	]);
	const seen = new Set<string>([correctTrait]);
	const distractors: string[] = [];
	for (const c of pool) {
		const v = c[field];
		if (isUsable(v) && !seen.has(v)) {
			seen.add(v);
			distractors.push(v);
			if (distractors.length === 3) break;
		}
	}
	if (distractors.length < 3) return null;

	const { options, answerIndex } = buildOptions(correctTrait, distractors);
	return {
		id: nanoid(),
		category: 'character-trait',
		prompt: `What is ${character.name}'s ${field}?`,
		options,
		answerIndex,
		source: {
			label: `${character.name} — ${field}: ${correctTrait}`,
			...(character.wikiUrl ? { wikiUrl: character.wikiUrl } : {})
		}
	};
}

async function makeForCategory(category: Category): Promise<QuizQuestion | null> {
	switch (category) {
		case 'who-said-it':
			return makeWhoSaidIt();
		case 'quote-movie':
			return makeQuoteMovie();
		case 'character-trait':
			return makeCharacterTrait();
	}
}

export const quizController = {
	getRound: async (_req: Request, res: Response, next: NextFunction) => {
		try {
			const plan = shuffle([...CATEGORY_PLAN]);
			const questions: QuizQuestion[] = [];

			for (const category of plan) {
				let q = await makeForCategory(category);
				// If a less-reliable category came up dry (e.g. very small movie set),
				// substitute who-said-it so the round still has 10 questions.
				if (!q && category !== 'who-said-it') {
					// eslint-disable-next-line no-console
					console.warn(`[quiz] category ${category} produced no question; substituting who-said-it`);
					q = await makeWhoSaidIt();
				}
				if (q) questions.push(q);
			}

			if (questions.length === 0) {
				return res.status(HttpCode.NOT_FOUND).json({
					success: false,
					message: 'Not enough data to build a quiz round.'
				});
			}

			return res.json(questions);
		} catch (err) {
			return next(err);
		}
	}
};
