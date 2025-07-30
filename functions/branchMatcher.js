/**
 * Branch pattern matching utility
 * Supports wildcard patterns like "features/*" to match branches with prefixes
 */

/**
 * Checks if a branch name matches a pattern
 * Supports:
 * - "*" for all branches
 * - "exact-branch-name" for exact matches
 * - "prefix/*" for prefix matching (e.g., "features/*" matches "features/api", "features/front-end")
 * 
 * @param {string} branchName - The actual branch name from the webhook
 * @param {string} pattern - The pattern to match against
 * @returns {boolean} - True if the branch matches the pattern
 */
function matchesBranchPattern(branchName, pattern) {
  // Handle wildcard for all branches
  if (pattern === '*') {
    return true;
  }
  
  // Handle exact match
  if (pattern === branchName) {
    return true;
  }
  
  // Handle prefix patterns (e.g., "features/*")
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2); // Remove "/*"
    return branchName.startsWith(prefix + '/');
  }
  
  return false;
}

/**
 * Finds all tracked branch patterns that match a given branch name
 * @param {Array} trackedBranches - Array of tracked branch objects with branchName property
 * @param {string} branchName - The branch name to match against
 * @returns {Array} - Array of matching tracked branch objects
 */
function findMatchingBranches(trackedBranches, branchName) {
  return trackedBranches.filter(trackedBranch => 
    matchesBranchPattern(branchName, trackedBranch.branchName)
  );
}

/**
 * Validates a branch pattern
 * @param {string} pattern - The pattern to validate
 * @returns {boolean} - True if the pattern is valid
 */
function isValidBranchPattern(pattern) {
  // Allow "*" for all branches
  if (pattern === '*') {
    return true;
  }
  
  // Allow exact branch names (no special characters except allowed ones)
  if (!pattern.includes('*')) {
    // Allow alphanumeric, hyphens, underscores, slashes, and dots
    return /^[a-zA-Z0-9\-_/.]+$/.test(pattern);
  }
  
  // Allow prefix patterns ending with "/*"
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2);
    // Prefix should not be empty and should not contain wildcards
    return prefix.length > 0 && !prefix.includes('*') && /^[a-zA-Z0-9\-_/.]+$/.test(prefix);
  }
  
  // No other wildcard patterns are supported
  return false;
}

/**
 * Gets a human-readable description of a branch pattern
 * @param {string} pattern - The pattern to describe
 * @returns {string} - Human-readable description
 */
function describeBranchPattern(pattern) {
  if (pattern === '*') {
    return 'All branches';
  }
  
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2);
    return `Branches starting with "${prefix}/"`;
  }
  
  return `Branch "${pattern}"`;
}

module.exports = {
  matchesBranchPattern,
  findMatchingBranches,
  isValidBranchPattern,
  describeBranchPattern
};
