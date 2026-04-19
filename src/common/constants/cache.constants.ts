export const CACHE_TTL = {
  USER_PROFILE: 3600, // seconds (1 hour)
  FRIENDS: 300, // seconds (5 mins)
};

export const RATE_LIMIT = {
  DEFAULT_LIMIT: 60,
  DEFAULT_TTL_MS: 60000, // milliseconds
};
export const CACHE_KEYS = {
  USER_PROFILE: (id: string) => `user_profile:${id}`,
};
