// Replacing a banner deleted the outgoing image outright. When that image had been
// picked from the media library — which is the normal way banners get set — the bytes
// went while the MediaFile row, the library listing, and every other record pointing
// at the same file all stayed behind.
//
// It cost three banners in an afternoon: replacing one service's picture silently
// emptied another service's and a team's, because all three had been set from the
// same library file. Nothing errored; the images simply 404'd from then on.
//
// A library file is shared by definition, so its lifetime belongs to the library and
// its own delete route, not to whichever record happens to stop using it first.

const mockExists = jest.fn();
const mockDelete = jest.fn();

jest.mock('../models/MediaFile', () => ({
  exists: (...args) => mockExists(...args),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send() {
      return Promise.resolve({});
    }
  },
  PutObjectCommand: class {},
  DeleteObjectCommand: class {},
  GetObjectCommand: class {},
  HeadObjectCommand: class {},
  ListObjectsV2Command: class {},
}));

const storageService = require('../services/storageService');

beforeEach(() => {
  mockExists.mockReset();
  mockDelete.mockReset();
  jest.spyOn(storageService, 'deleteImage').mockImplementation(mockDelete);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('storageService.releaseImage', () => {
  it('keeps a file the media library owns', async () => {
    mockExists.mockResolvedValue({ _id: 'media-1' });

    const result = await storageService.releaseImage('general/shared.webp');

    expect(mockDelete).not.toHaveBeenCalled();
    expect(result.deleted).toBe(false);
  });

  it('says why it kept it', async () => {
    mockExists.mockResolvedValue({ _id: 'media-1' });

    const result = await storageService.releaseImage('general/shared.webp');

    expect(result.reason).toMatch(/media library/i);
  });

  it('deletes a file nothing in the library claims', async () => {
    // A one-off upload for this record alone: safe to remove, and leaving it would
    // orphan bytes nothing can reach.
    mockExists.mockResolvedValue(null);

    const result = await storageService.releaseImage(
      'services/abc/one-off.webp'
    );

    expect(mockDelete).toHaveBeenCalledWith('services/abc/one-off.webp');
    expect(result.deleted).toBe(true);
  });

  it('looks the key up rather than guessing from its shape', async () => {
    mockExists.mockResolvedValue(null);

    await storageService.releaseImage('general/x.webp');

    expect(mockExists).toHaveBeenCalledWith({ key: 'general/x.webp' });
  });

  it('does nothing when there is no key', async () => {
    const result = await storageService.releaseImage(undefined);

    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockExists).not.toHaveBeenCalled();
    expect(result.deleted).toBe(false);
  });

  it('is what the old behaviour was not: deleteImage removed it regardless', async () => {
    // Pins the distinction. deleteImage is still the right call for the media
    // library's own delete route, which owns the file and means it.
    mockExists.mockResolvedValue({ _id: 'media-1' });

    await storageService.deleteImage('general/shared.webp');

    expect(mockDelete).toHaveBeenCalledWith('general/shared.webp');
  });
});
