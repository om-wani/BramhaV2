/**
 * GitLab sync — delegates to the GitHub sync strategy.
 *
 * GitLab uses the same git clone mechanism; the only difference is
 * that GitLab PATs use 'oauth2' or 'glpat' prefixed tokens passed
 * as the password in the HTTPS URL (handled by syncGitRepo).
 */
export { syncGitRepo as syncGitLabRepo } from './github-sync.js'
