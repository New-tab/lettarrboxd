const mockAxiosInstance = {
  get: jest.fn(),
  post: jest.fn(),
  delete: jest.fn(),
};

jest.mock('axios', () => {
  return {
    create: jest.fn(() => mockAxiosInstance),
    default: {
      create: jest.fn(() => mockAxiosInstance),
    },
  };
});

jest.mock('../util/env', () => ({
  SEERR_API_URL: 'http://localhost:5055',
  SEERR_API_KEY: 'seerr-key',
}));

import {
  createMovieRequest,
  deleteMedia,
  deleteMediaFile,
  deleteMovieRequestByTmdbId,
  findMovieRequestIdByTmdbId,
  getMediaIdByTmdbId,
} from './seerr';

describe('seerr API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates movie requests through Seerr', async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 1 } });

    const result = await createMovieRequest('123');

    expect(result).toBe('created');
    expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/v1/request', {
      mediaType: 'movie',
      mediaId: 123,
    });
  });

  it('treats existing requests as already handled', async () => {
    mockAxiosInstance.post.mockRejectedValueOnce({
      response: {
        status: 409,
      },
    });

    const result = await createMovieRequest('123');

    expect(result).toBe('alreadyExists');
  });

  it('finds request IDs by nested media TMDb id', async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        results: [
          { id: 10, media: { tmdbId: 111 } },
          { id: 11, media: { tmdbId: 222 } },
        ],
      },
    });

    const result = await findMovieRequestIdByTmdbId('222');

    expect(result).toBe(11);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v1/request', {
      params: {
        take: 100,
        skip: 0,
        mediaType: 'movie',
        sortDirection: 'desc',
      },
    });
  });

  it('deletes matching requests by TMDb id', async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        results: [{ id: 33, media: { tmdbId: 333 } }],
      },
    });
    mockAxiosInstance.delete.mockResolvedValueOnce({});

    const result = await deleteMovieRequestByTmdbId('333');

    expect(result).toBe('deleted');
    expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/api/v1/request/33');
  });

  it('returns notFound when no matching request exists', async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        results: [],
      },
    });

    const result = await deleteMovieRequestByTmdbId('333');

    expect(result).toBe('notFound');
    expect(mockAxiosInstance.delete).not.toHaveBeenCalled();
  });

  describe('getMediaIdByTmdbId', () => {
    it('returns the Seerr mediaInfo id for a known TMDB id', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { mediaInfo: { id: 42 } },
      });

      const result = await getMediaIdByTmdbId('12345');

      expect(result).toBe(42);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v1/movie/12345');
    });

    it('returns null when movie has no mediaInfo', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: {} });

      const result = await getMediaIdByTmdbId('12345');

      expect(result).toBeNull();
    });

    it('returns null on 404', async () => {
      mockAxiosInstance.get.mockRejectedValueOnce({ response: { status: 404 } });

      const result = await getMediaIdByTmdbId('12345');

      expect(result).toBeNull();
    });
  });

  describe('deleteMediaFile', () => {
    it('returns deleted on success', async () => {
      mockAxiosInstance.delete.mockResolvedValueOnce({});

      const result = await deleteMediaFile(42);

      expect(result).toBe('deleted');
      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/api/v1/media/42/file');
    });

    it('returns notFound on 404', async () => {
      mockAxiosInstance.delete.mockRejectedValueOnce({ response: { status: 404 } });

      const result = await deleteMediaFile(42);

      expect(result).toBe('notFound');
    });
  });

  describe('deleteMedia', () => {
    it('returns deleted on success', async () => {
      mockAxiosInstance.delete.mockResolvedValueOnce({});

      const result = await deleteMedia(42);

      expect(result).toBe('deleted');
      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/api/v1/media/42');
    });

    it('returns notFound on 404', async () => {
      mockAxiosInstance.delete.mockRejectedValueOnce({ response: { status: 404 } });

      const result = await deleteMedia(42);

      expect(result).toBe('notFound');
    });
  });
});
