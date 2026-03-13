const MONGO_OBJECT_ID_REGEX = /^[a-fA-F0-9]{24}$/;

/** Streng validering av MongoDB ObjectId (24 hex-tegn). */
export function isValidMongoObjectId(value: string): boolean {
  return typeof value === "string" && MONGO_OBJECT_ID_REGEX.test(value);
}
