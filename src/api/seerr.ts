import Axios from 'axios';
import env from '../util/env';

export type CreateMovieRequestResult = 'created' | 'alreadyExists';
export type DeleteMovieRequestResult = 'deleted' | 'notFound';
export type DeleteMediaResult = 'deleted' | 'notFound';

interface SeerrRequestListResponse {
  results?: any[];
}

const axios = Axios.create({
  baseURL: env.SEERR_API_URL,
  headers: {
    'X-Api-Key': env.SEERR_API_KEY ?? '',
  },
});

function ensureSeerrConfigured(): void {
  if (!env.SEERR_API_URL || !env.SEERR_API_KEY) {
    throw new Error('SEERR_API_URL and SEERR_API_KEY are required for Seerr operations');
  }
}

function extractRequestTmdbId(request: any): number | null {
  const candidate =
    request?.media?.tmdbId ??
    request?.media?.tmdbid ??
    request?.media?.tmdb_id ??
    request?.tmdbId;

  return typeof candidate === 'number' ? candidate : null;
}

function extractRequestId(request: any): number | null {
  return typeof request?.id === 'number' ? request.id : null;
}

function isExistingRequestError(error: any): boolean {
  const status = error?.response?.status;
  const rawMessage =
    typeof error?.response?.data === 'string'
      ? error.response.data
      : error?.response?.data?.message;
  const message = Array.isArray(rawMessage)
    ? rawMessage.join(' ')
    : typeof rawMessage === 'string'
      ? rawMessage
      : '';

  return (
    status === 409 ||
    /already requested|already available|already exists/i.test(message)
  );
}

export async function createMovieRequest(
  tmdbId: number | string
): Promise<CreateMovieRequestResult> {
  ensureSeerrConfigured();
  try {
    await axios.post('/api/v1/request', {
      mediaType: 'movie',
      mediaId: Number(tmdbId),
    });
    return 'created';
  } catch (error: any) {
    if (isExistingRequestError(error)) {
      return 'alreadyExists';
    }

    throw error;
  }
}

export async function findMovieRequestIdByTmdbId(
  tmdbId: number | string
): Promise<number | null> {
  ensureSeerrConfigured();
  const targetTmdbId = Number(tmdbId);
  const pageSize = 100;
  let skip = 0;

  while (true) {
    const response = await axios.get<SeerrRequestListResponse>('/api/v1/request', {
      params: {
        take: pageSize,
        skip,
        mediaType: 'movie',
        sortDirection: 'desc',
      },
    });

    const results = Array.isArray(response.data?.results)
      ? response.data.results
      : [];

    const match = results.find(request => extractRequestTmdbId(request) === targetTmdbId);
    const requestId = match ? extractRequestId(match) : null;
    if (requestId !== null) {
      return requestId;
    }

    if (results.length < pageSize) {
      return null;
    }

    skip += results.length;
  }
}

export async function getMediaIdByTmdbId(
  tmdbId: number | string
): Promise<number | null> {
  ensureSeerrConfigured();
  try {
    const response = await axios.get(`/api/v1/movie/${Number(tmdbId)}`);
    const mediaId = response.data?.mediaInfo?.id;
    return typeof mediaId === 'number' ? mediaId : null;
  } catch (error: any) {
    if (error?.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function deleteMediaFile(mediaId: number): Promise<DeleteMediaResult> {
  ensureSeerrConfigured();
  try {
    await axios.delete(`/api/v1/media/${mediaId}/file`);
    return 'deleted';
  } catch (error: any) {
    if (error?.response?.status === 404) {
      return 'notFound';
    }
    throw error;
  }
}

export async function deleteMedia(mediaId: number): Promise<DeleteMediaResult> {
  ensureSeerrConfigured();
  try {
    await axios.delete(`/api/v1/media/${mediaId}`);
    return 'deleted';
  } catch (error: any) {
    if (error?.response?.status === 404) {
      return 'notFound';
    }
    throw error;
  }
}

export async function deleteMovieRequestByTmdbId(
  tmdbId: number | string
): Promise<DeleteMovieRequestResult> {
  const requestId = await findMovieRequestIdByTmdbId(tmdbId);

  if (requestId === null) {
    return 'notFound';
  }

  try {
    await axios.delete(`/api/v1/request/${requestId}`);
    return 'deleted';
  } catch (error: any) {
    if (error?.response?.status === 404) {
      return 'notFound';
    }

    throw error;
  }
}
