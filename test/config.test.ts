import { afterEach, describe, expect, it } from 'vitest';
import { apiUrl, configureBackend, resetBackendConfig, sessionStorageKey } from '../src/config.js';

afterEach(() => resetBackendConfig());

describe('configureBackend', () => {
	it('prefixes absolute API paths with the configured origin', () => {
		configureBackend({ backendDomain: 'https://table.novasplit.ai' });
		expect(apiUrl('/api/v1/tables')).toBe('https://table.novasplit.ai/api/v1/tables');
	});

	it('keeps a same-origin base for development builds', () => {
		configureBackend({ backendDomain: '' });
		expect(apiUrl('/api/v1/tables')).toBe('/api/v1/tables');
	});

	it('tolerates a trailing slash on the origin', () => {
		configureBackend({ backendDomain: 'https://stage-table.novasplit.ai/' });
		expect(apiUrl('/api/v1/login/me')).toBe('https://stage-table.novasplit.ai/api/v1/login/me');
	});

	it('rejects relative paths: callers pass the API path', () => {
		configureBackend({ backendDomain: 'https://table.novasplit.ai' });
		expect(() => apiUrl('api/v1/tables')).toThrow();
	});

	it('names each origin its own session slot', () => {
		configureBackend({ backendDomain: 'https://table.novasplit.ai' });
		expect(sessionStorageKey()).toBe('loginInfo:https://table.novasplit.ai');
		configureBackend({ backendDomain: 'https://stage-table.novasplit.ai' });
		expect(sessionStorageKey()).not.toBe('loginInfo:https://table.novasplit.ai');
	});
});
