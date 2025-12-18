export const isDev = process.env.__DEV__ === 'true';
export const isProduction = !isDev;
export const isStore = process.env.__STORE__ === 'true';
