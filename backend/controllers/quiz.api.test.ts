import express, { Router } from 'express';
import request from 'supertest';
const mockingoose = require('mockingoose');

import { HttpCode } from '../helpers/constants';
import { errorHandler } from '../middleware/api.errors';
import { quizController } from './quiz.api';
import { QuoteModel } from '../models/quote.model';
import { CharacterModel } from '../models/character.model';
import { MovieModel } from '../models/movie.model';

const app = express();
const router = Router();

router.route('/quiz/round').get(quizController.getRound);

app.use(express.json());
app.use('/v2', router);
app.use(errorHandler);

// Single quote whose $lookup has already produced character + movie sub-docs.
// mockingoose ignores aggregate pipelines, so we return the post-lookup shape directly.
const fakeQuote = {
	_id: 'q1',
	dialog: '  You   shall not   pass!  ',
	character: {
		_id: 'c0',
		name: 'Gandalf',
		wikiUrl: 'http://example.com/gandalf',
		race: 'Maia',
		realm: 'Valinor'
	},
	movie: {
		_id: 'm1',
		name: 'The Fellowship of the Ring'
	}
};

const fakeCharacters = [
	{ _id: 'c1', name: 'Frodo', wikiUrl: 'http://example.com/frodo', race: 'Hobbit', realm: 'Shire' },
	{ _id: 'c2', name: 'Aragorn', wikiUrl: 'http://example.com/aragorn', race: 'Man', realm: 'Gondor' },
	{ _id: 'c3', name: 'Legolas', race: 'Elf', realm: 'Mirkwood' },
	{ _id: 'c4', name: 'Gimli', race: 'Dwarf', realm: 'Erebor' },
	{ _id: 'c5', name: 'Boromir', race: 'Man', realm: 'Gondor' }
];

const fakeMovies = [
	{ _id: 'm2', name: 'The Two Towers' },
	{ _id: 'm3', name: 'The Return of the King' },
	{ _id: 'm4', name: 'An Unexpected Journey' }
];

describe('quiz controller', () => {
	let warnSpy: jest.SpyInstance;

	beforeAll(() => {
		// The controller intentionally console.warns when it falls back to who-said-it.
		// That's expected here because mockingoose doesn't replay aggregate calls,
		// so later aggregations come back empty and trigger the fallback path.
		warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
	});

	afterAll(() => {
		warnSpy.mockRestore();
	});

	beforeEach(() => {
		mockingoose.resetAll();
	});

	it('/quiz/round returns 10 well-formed multiple-choice questions', async () => {
		mockingoose(QuoteModel).toReturn([fakeQuote], 'aggregate');
		mockingoose(CharacterModel).toReturn(fakeCharacters, 'aggregate');
		mockingoose(MovieModel).toReturn(fakeMovies, 'aggregate');

		const response = await request(app).get('/v2/quiz/round');

		expect(response.statusCode).toEqual(HttpCode.OK);
		expect(Array.isArray(response.body)).toBe(true);
		expect(response.body).toHaveLength(10);

		const validCategories = new Set(['who-said-it', 'quote-movie']);
		for (const q of response.body) {
			expect(typeof q.id).toBe('string');
			expect(q.id.length).toBeGreaterThan(0);
			expect(validCategories.has(q.category)).toBe(true);
			expect(typeof q.prompt).toBe('string');
			expect(q.prompt.length).toBeGreaterThan(0);
			expect(Array.isArray(q.options)).toBe(true);
			expect(q.options).toHaveLength(4);
			expect(new Set(q.options).size).toBe(4); // all options distinct
			expect(q.options.every((o: unknown) => typeof o === 'string' && o.length > 0)).toBe(true);
			expect(Number.isInteger(q.answerIndex)).toBe(true);
			expect(q.answerIndex).toBeGreaterThanOrEqual(0);
			expect(q.answerIndex).toBeLessThanOrEqual(3);
			expect(typeof q.source.label).toBe('string');
			expect(q.source.label.length).toBeGreaterThan(0);
		}
	});

	it('quote prompts strip the whitespace that the aggregate path bypasses', async () => {
		mockingoose(QuoteModel).toReturn([fakeQuote], 'aggregate');
		mockingoose(CharacterModel).toReturn(fakeCharacters, 'aggregate');
		mockingoose(MovieModel).toReturn(fakeMovies, 'aggregate');

		const response = await request(app).get('/v2/quiz/round');

		const quoteQuestions = response.body.filter(
			(q: { category: string }) => q.category === 'who-said-it' || q.category === 'quote-movie'
		);
		expect(quoteQuestions.length).toBeGreaterThan(0);
		for (const q of quoteQuestions) {
			expect(q.prompt).toContain('You shall not pass!');
			expect(q.prompt).not.toMatch(/\s{2,}/);
		}
	});

	it('who-said-it questions credit the correct character via source.label', async () => {
		mockingoose(QuoteModel).toReturn([fakeQuote], 'aggregate');
		mockingoose(CharacterModel).toReturn(fakeCharacters, 'aggregate');
		mockingoose(MovieModel).toReturn(fakeMovies, 'aggregate');

		const response = await request(app).get('/v2/quiz/round');

		const whoSaid = response.body.filter((q: { category: string }) => q.category === 'who-said-it');
		expect(whoSaid.length).toBeGreaterThan(0);
		for (const q of whoSaid) {
			expect(q.source.label).toBe('Gandalf');
			expect(q.options[q.answerIndex]).toBe('Gandalf');
			expect(q.source.wikiUrl).toBe('http://example.com/gandalf');
		}
	});

	it('quote-movie questions credit the correct movie via source.label', async () => {
		mockingoose(QuoteModel).toReturn([fakeQuote], 'aggregate');
		mockingoose(CharacterModel).toReturn(fakeCharacters, 'aggregate');
		mockingoose(MovieModel).toReturn(fakeMovies, 'aggregate');

		const response = await request(app).get('/v2/quiz/round');

		const quoteMovie = response.body.filter((q: { category: string }) => q.category === 'quote-movie');
		expect(quoteMovie.length).toBeGreaterThan(0);
		for (const q of quoteMovie) {
			expect(q.source.label).toBe('The Fellowship of the Ring');
			expect(q.options[q.answerIndex]).toBe('The Fellowship of the Ring');
		}
	});

	it('returns 404 when no data is available to build a round', async () => {
		mockingoose(QuoteModel).toReturn([], 'aggregate');
		mockingoose(CharacterModel).toReturn([], 'aggregate');
		mockingoose(MovieModel).toReturn([], 'aggregate');

		const response = await request(app).get('/v2/quiz/round');

		expect(response.statusCode).toEqual(HttpCode.NOT_FOUND);
		expect(response.body.success).toBe(false);
	});

	it('forwards aggregate errors to the global errorHandler', async () => {
		mockingoose(QuoteModel).toReturn(new Error('boom'), 'aggregate');
		mockingoose(CharacterModel).toReturn(fakeCharacters, 'aggregate');
		mockingoose(MovieModel).toReturn(fakeMovies, 'aggregate');

		const response = await request(app).get('/v2/quiz/round');

		expect(response.statusCode).toEqual(HttpCode.SERVER_ERROR);
		expect(response.body.success).toBe(false);
		expect(response.body.message).toBe('Something went wrong.');
	});
});
