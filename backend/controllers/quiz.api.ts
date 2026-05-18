import { Request, Response, NextFunction } from 'express';
import { nanoid } from 'nanoid';

import { QuoteModel } from '../models/quote.model';
import { CharacterModel } from '../models/character.model';
import { MovieModel } from '../models/movie.model';
import { HttpCode } from '../helpers/constants';

type Category = 'who-said-it' | 'quote-movie';

interface QuizQuestion {
	id: string;
	category: Category;
	prompt: string;
	options: string[];
	answerIndex: number;
	source: { label: string; wikiUrl?: string };
}

// 5/5 mix of quote-based questions per round, shuffled per request.
const CATEGORY_PLAN: Category[] = [
	'who-said-it',
	'who-said-it',
	'who-said-it',
	'who-said-it',
	'who-said-it',
	'quote-movie',
	'quote-movie',
	'quote-movie',
	'quote-movie',
	'quote-movie'
];

// Below ~25 chars, dialog is mostly proper nouns or stock interjections
// ("Aragorn!", "DEATH!", "My precious.") that carry no signal about which
// film or character the line belongs to. Filter them out at the Mongo
// stage so $sample only sees the corpus of memorable lines.
const MIN_DIALOG_LEN = 25;

// SCREAMING_SNAKE_CASE entries in the characters collection are the
// scraper's placeholder for unnamed minor characters (e.g. MINOR_CHARACTER,
// which owns ~117 quotes in the seed). Treat them as nonexistent — no
// player can guess them and they're useless as distractors.
const REAL_NAME_REGEX = /^(?![A-Z_]+$).+/;

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

const memorableDialogMatch = {
	dialog: { $type: 'string' as const },
	$expr: { $gte: [{ $strLenCP: '$dialog' }, MIN_DIALOG_LEN] }
};

async function makeWhoSaidIt(): Promise<QuizQuestion | null> {
	const quotes: any[] = await QuoteModel.aggregate([
		{ $match: { character: { $exists: true, $ne: null }, ...memorableDialogMatch } },
		{ $sample: { size: 1 } },
		{ $lookup: { from: 'characters', localField: 'character', foreignField: '_id', as: 'character' } },
		{ $unwind: '$character' },
		{ $match: { 'character.name': { $type: 'string', $regex: REAL_NAME_REGEX } } }
	]);
	if (!quotes.length) return null;
	const quote = quotes[0];
	const correct = quote.character;

	const distractors: any[] = await CharacterModel.aggregate([
		{
			$match: {
				_id: { $ne: correct._id },
				name: { $type: 'string', $regex: REAL_NAME_REGEX }
			}
		},
		{ $sample: { size: 3 } }
	]);
	const distractorNames = distractors.slice(0, 3).map((d) => d.name);
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
		{ $match: memorableDialogMatch },
		{ $sample: { size: 1 } },
		{ $lookup: { from: 'movies', localField: 'movie', foreignField: '_id', as: 'movie' } },
		{ $unwind: '$movie' },
		{ $match: { 'movie.name': { $type: 'string', $ne: '' } } }
	]);
	if (!quotes.length) return null;
	const quote = quotes[0];
	const correct = quote.movie;

	const distractors: any[] = await MovieModel.aggregate([
		{ $match: { _id: { $ne: correct._id }, name: { $type: 'string', $ne: '' } } },
		{ $sample: { size: 3 } }
	]);
	const distractorNames = distractors.slice(0, 3).map((d) => d.name);
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

async function makeForCategory(category: Category): Promise<QuizQuestion | null> {
	switch (category) {
		case 'who-said-it':
			return makeWhoSaidIt();
		case 'quote-movie':
			return makeQuoteMovie();
	}
}

export const quizController = {
	getRound: async (_req: Request, res: Response, next: NextFunction) => {
		try {
			const plan = shuffle([...CATEGORY_PLAN]);
			const questions: QuizQuestion[] = [];

			for (const category of plan) {
				let q = await makeForCategory(category);
				// Fall back to who-said-it if quote-movie comes up dry (small movie set).
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
