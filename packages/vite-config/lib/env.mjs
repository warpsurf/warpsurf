export const isDev = process.env.__DEV__ === 'true';
export const isProduction = !isDev;
export const isStore = process.env.__STORE__ === 'true';
export const isAPI = process.env.__API__ === 'true';
export const isLegacyNavigation = process.env.__LEGACY_NAVIGATION__ === 'true';
export const enableSiteSkills = process.env.__ENABLE_SITE_SKILLS__ !== 'false';