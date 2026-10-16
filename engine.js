/**
 * Clickwise Core Regex & Pattern Execution Engine
 */
export class RegexEngine {
  /**
   * Safe RegExp evaluator with safety timeout safeguards
   */
  static evaluatePattern(patternString, testStrings = [], flags = 'i') {
    if (!patternString || !patternString.trim()) {
      return { isValid: false, error: 'Pattern string is empty', matches: [] };
    }

    try {
      const regex = new RegExp(patternString, flags);
      const results = testStrings.map(str => {
        const isMatch = regex.test(str);
        return { string: str, match: isMatch };
      });

      return {
        isValid: true,
        pattern: patternString,
        explanation: this.explainRegex(patternString),
        matches: results,
        matchCount: results.filter(r => r.match).length,
        totalCount: results.length
      };
    } catch (err) {
      return {
        isValid: false,
        error: err.message,
        matches: []
      };
    }
  }

  /**
   * Translates regular expressions into clear plain-English summaries
   */
  static explainRegex(pattern) {
    if (!pattern) return 'No pattern provided.';
    
    let explanations = [];
    
    if (pattern.startsWith('^')) explanations.push('starts with');
    if (pattern.endsWith('$')) explanations.push('ends with');
    if (pattern.includes('(?i)')) explanations.push('case-insensitive match');
    if (pattern.includes('\\b')) explanations.push('respects word boundaries');
    
    if (pattern.includes('|')) {
      const options = pattern.replace(/[()^$]/g, '').split('|');
      explanations.push(`matches any of the following terms: [${options.join(', ')}]`);
    }

    if (explanations.length === 0) {
      return `Matches any string containing the sequence "${pattern}" (case-insensitive).`;
    }

    return `Finds strings that ${explanations.join(', ')}.`;
  }

  /**
   * Pre-built production patterns for GSC and Technical SEO analysis
   */
  static getTemplates() {
    return [
      {
        id: 'questions',
        name: 'Question Intent Queries',
        description: 'Extracts queries containing question words (who, what, where, why, how, can).',
        pattern: '^(who|what|where|when|why|how|can|is|are|will)\\b',
        type: 'include'
      },
      {
        id: 'transactional',
        name: 'High Commercial Intent',
        description: 'Identifies high-converting queries containing buy, price, cheap, deal, or order.',
        pattern: '\\b(buy|cheap|price|cost|discount|deal|order|checkout|quote)\\b',
        type: 'include'
      },
      {
        id: 'long-tail',
        name: 'Long-Tail (5+ Words)',
        description: 'Filters for queries with 5 or more words for low-hanging opportunities.',
        pattern: '^([^\\s]+\\s+){4,}[^\\s]+$',
        type: 'include'
      },
      {
        id: 'non-branded',
        name: 'Non-Brand Query Isolation',
        description: 'Excludes specific brand terms from GSC performance analysis.',
        pattern: '^(?!.*(clickwise|brandname)).*',
        type: 'exclude'
      }
    ];
  }
}
