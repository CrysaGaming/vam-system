// Track 5 #15 (Section C) — PIREP Photo Posts.
//
// URL-based photo attachments an PIREPs (kein file-upload V1).
// Helpers für list/create/delete, plus error-classes und limit-constants.
export {
  listPhotosForPirep,
  getPhotoCount,
  createPhoto,
  deletePhoto,
  PhotoNotFoundError,
  PhotoForbiddenError,
  PhotoUrlError,
  PhotoCaptionError,
  PhotoLimitError,
  PHOTO_MAX_URL_CHARS,
  PHOTO_MAX_CAPTION_CHARS,
  MAX_PHOTOS_PER_PIREP,
  type PhotoEntry,
} from "./photo.js";
