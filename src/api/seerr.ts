import Axios from 'axios';
import env from '../util/env';

export type CreateMovieRequestResult = 'created' | 'alreadyExists';
export type DeleteMediaResult = 'deleted' | 'notFound';

const axios = Axios.create({
  baseURL: env.SEERR_API_URL,
  headers: {
    'X-Api-Key': env.SEERR_API_KEY ?? '',
  },
});

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

export async function getMediaIdByTmdbId(
  tmdbId: number | string
): Promise<number | null> {
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
