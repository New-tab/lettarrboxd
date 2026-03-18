import {
  detectListType,
  fetchMoviesFromUrl,
  getSyncModeForListType,
  getSyncModeForUrl,
  ListType,
} from './index';
import { ListScraper } from './list';
import { CollectionsScraper } from './collections';
import { PopularScraper } from './popular';

jest.mock('../util/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../util/env', () => ({
  LETTERBOXD_URL: 'https://letterboxd.com/user/watchlist',
  LETTERBOXD_TAKE_AMOUNT: undefined,
  LETTERBOXD_TAKE_STRATEGY: undefined,
}));

jest.mock('./list');
jest.mock('./collections');
jest.mock('./popular');

describe('scraper index', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('detects diary URLs', () => {
    expect(detectListType('https://letterboxd.com/user/films/diary')).toBe(ListType.DIARY);
    expect(detectListType('https://letterboxd.com/user/films/diary/')).toBe(ListType.DIARY);
  });

  it('maps watched and diary URLs to delete mode', () => {
    expect(getSyncModeForListType(ListType.WATCHED_MOVIES)).toBe('delete');
    expect(getSyncModeForListType(ListType.DIARY)).toBe('delete');
    expect(getSyncModeForUrl('https://letterboxd.com/user/films')).toBe('delete');
    expect(getSyncModeForUrl('https://letterboxd.com/user/films/')).toBe('delete');
    expect(getSyncModeForUrl('https://letterboxd.com/user/films/diary')).toBe('delete');
    expect(getSyncModeForUrl('https://letterboxd.com/user/films/diary/')).toBe('delete');
  });

  it('maps watchlists to request mode', () => {
    expect(getSyncModeForListType(ListType.WATCHLIST)).toBe('request');
    expect(getSyncModeForUrl('https://letterboxd.com/user/watchlist')).toBe('request');
  });

  it('maps regular Letterboxd lists to request mode', () => {
    expect(getSyncModeForListType(ListType.REGULAR_LIST)).toBe('request');
    expect(getSyncModeForUrl('https://letterboxd.com/user/list/some-list/')).toBe('request');
  });

  it('fetches diary URLs with the list scraper', async () => {
    const mockMovies = [
      { id: 1, name: 'Movie 1', slug: '/film/movie1/', tmdbId: '123', imdbId: null, publishedYear: null },
    ];

    const mockGetMovies = jest.fn().mockResolvedValue(mockMovies);
    (ListScraper as jest.Mock).mockImplementation(() => ({
      getMovies: mockGetMovies,
    }));

    const result = await fetchMoviesFromUrl('https://letterboxd.com/user/films/diary');

    expect(result).toEqual(mockMovies);
    expect(ListScraper).toHaveBeenCalledWith(
      'https://letterboxd.com/user/films/diary',
      undefined,
      undefined
    );
  });

  it('still routes collection URLs through the collections scraper', async () => {
    const mockMovies = [
      { id: 1, name: 'Movie 1', slug: '/film/movie1/', tmdbId: '123', imdbId: null, publishedYear: null },
    ];

    const mockGetMovies = jest.fn().mockResolvedValue(mockMovies);
    (CollectionsScraper as jest.Mock).mockImplementation(() => ({
      getMovies: mockGetMovies,
    }));

    const result = await fetchMoviesFromUrl('https://letterboxd.com/films/in/marvel-cinematic-universe');

    expect(result).toEqual(mockMovies);
    expect(CollectionsScraper).toHaveBeenCalled();
  });

  it('still routes popular URLs through the popular scraper', async () => {
    const mockMovies = [
      { id: 1, name: 'Movie 1', slug: '/film/movie1/', tmdbId: '123', imdbId: null, publishedYear: null },
    ];

    const mockGetMovies = jest.fn().mockResolvedValue(mockMovies);
    (PopularScraper as jest.Mock).mockImplementation(() => ({
      getMovies: mockGetMovies,
    }));

    const result = await fetchMoviesFromUrl('https://letterboxd.com/films/popular');

    expect(result).toEqual(mockMovies);
    expect(PopularScraper).toHaveBeenCalled();
  });
});
