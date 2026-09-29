// Kept apart from the template schemas so a page that only checks a picture,
// such as the one a signer opens, doesn't load every schema with it.

/** Maximum encoded length accepted for an embedded PNG or JPEG image. */
export const MAX_IMAGE_DATA_URL_LENGTH = 2_800_000

/** Canonical data URI pattern accepted for embedded PNG and JPEG images. */
export const IMAGE_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/
