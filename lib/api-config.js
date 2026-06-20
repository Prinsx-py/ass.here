/**
 * API Configuration Module
 * 
 * Provides configuration management for the ass.here API client.
 * Supports environment variables, fallbacks, and robust error handling.
 * 
 * Environment Variables:
 * - ASS_HERE_API_BASE: Override the default API base URL
 * - ASS_HERE_TIMEOUT: Request timeout in milliseconds (default: 10000)
 * - ASS_HERE_RETRY_COUNT: Number of retries on failure (default: 2)
 */

class ApiConfig {
  constructor() {
    // Default API base URL - should be customizable
    this.defaultBase = 'https://ass.here';
    
    // Fallback URLs to try if primary fails (in order)
    this.fallbackBases = [
      'https://api.ass.here',
      // Users can add their own via environment or configuration
    ];
    
    // Configuration loaded from environment or browser storage
    this.customBase = this.getEnvironmentBase();
    this.timeout = this.getTimeout();
    this.retryCount = this.getRetryCount();
  }

  /**
   * Get API base from environment variable or localStorage
   */
  getEnvironmentBase() {
    // In Node.js/Vercel environment
    if (typeof process !== 'undefined' && process.env) {
      return process.env.ASS_HERE_API_BASE || '';
    }
    
    // In browser environment
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('ASS_HERE_API_BASE') || '';
    }
    
    return '';
  }

  getTimeout() {
    if (typeof process !== 'undefined' && process.env) {
      return parseInt(process.env.ASS_HERE_TIMEOUT || '10000', 10);
    }
    return 10000;
  }

  getRetryCount() {
    if (typeof process !== 'undefined' && process.env) {
      return parseInt(process.env.ASS_HERE_RETRY_COUNT || '2', 10);
    }
    return 2;
  }

  /**
   * Get the currently active API base URL
   */
  getApiBase() {
    if (this.customBase) return this.customBase;
    return this.defaultBase;
  }

  /**
   * Set a custom API base (persists to localStorage in browser)
   */
  setApiBase(url) {
    // Validate URL format
    try {
      new URL(url);
    } catch (err) {
      throw new Error(`Invalid API base URL: ${url}`);
    }
    
    this.customBase = url;
    
    // Persist in browser if available
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('ASS_HERE_API_BASE', url);
    }
  }

  /**
   * Get all candidate URLs to try (in order of preference)
   */
  getCandidateUrls() {
    const candidates = [];
    
    if (this.customBase) {
      candidates.push(this.customBase);
    }
    
    candidates.push(this.defaultBase);
    candidates.push(...this.fallbackBases);
    
    // Remove duplicates while preserving order
    return [...new Set(candidates)];
  }

  /**
   * Fetch with retry logic and timeout
   */
  async fetch(endpoint, options = {}) {
    const candidates = this.getCandidateUrls();
    let lastError = null;

    for (let attempt = 0; attempt < this.retryCount + 1; attempt++) {
      for (const baseUrl of candidates) {
        try {
          const url = new URL(endpoint, baseUrl).toString();
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), this.timeout);

          const response = await fetch(url, {
            ...options,
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (!response.ok && attempt < this.retryCount) {
            lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
            continue;
          }

          return response;
        } catch (err) {
          lastError = err;
          
          // Log DNS/network errors for debugging
          if (err.message.includes('ENOTFOUND') || err.message.includes('DNS')) {
            console.warn(`DNS resolution failed for ${baseUrl}${endpoint}`);
          } else if (err.name === 'AbortError') {
            console.warn(`Request timeout for ${baseUrl}${endpoint}`);
          }
          
          continue;
        }
      }
    }

    const error = lastError || new Error('All API base URLs failed');
    error.code = 'API_UNREACHABLE';
    error.candidates = candidates;
    throw error;
  }

  /**
   * Fetch JSON with automatic error handling
   */
  async fetchJson(endpoint, options = {}) {
    const response = await this.fetch(endpoint, options);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    return response.json();
  }
}

// Export singleton instance
export const apiConfig = new ApiConfig();

/**
 * Helper function to provide user-friendly error messages
 */
export function getErrorMessage(error) {
  if (error.code === 'API_UNREACHABLE') {
    return `The API server (${error.candidates.join(', ')}) is not reachable. ` +
           `Please check your internet connection or configure a custom API base via ASS_HERE_API_BASE environment variable.`;
  }
  
  if (error.message.includes('ENOTFOUND')) {
    return `DNS resolution failed. The domain could not be found. ` +
           `Please check your internet connection or configure a custom API base.`;
  }
  
  if (error.name === 'AbortError') {
    return `Request timed out. The API server is taking too long to respond. ` +
           `Try again or configure a custom API base.`;
  }
  
  return error.message || 'Unknown error occurred';
}

export default apiConfig;
