// 로그인 토큰(JWT 7일). localStorage에 둔다
const KEY = 'hookbuffer.token';

export const getToken = (): string | null => localStorage.getItem(KEY);
export const setToken = (token: string): void => localStorage.setItem(KEY, token);
export const clearToken = (): void => localStorage.removeItem(KEY);
