import { ReferenceScheme } from './enums';

export interface ParsedUri {
  scheme: string;
  path: string;
  params: Record<string, string>;
  raw: string;
}

export class CanonicalUri {
  /**
   * Parse a canonical URI (e.g. github://issue/org/repo/12 or agent://agy/run/101)
   */
  static parse(uri: string): ParsedUri {
    const match = uri.match(/^([a-zA-Z0-9_\-]+):\/\/(.*)$/);
    if (!match) {
      return {
        scheme: 'raw',
        path: uri,
        params: {},
        raw: uri,
      };
    }

    const scheme = match[1];
    const rest = match[2];
    const [pathPart, queryPart] = rest.split('?');

    const params: Record<string, string> = {};
    if (queryPart) {
      const searchParams = new URLSearchParams(queryPart);
      searchParams.forEach((val, key) => {
        params[key] = val;
      });
    }

    return {
      scheme,
      path: pathPart,
      params,
      raw: uri,
    };
  }

  static githubIssue(repo: string, issueNumber: number | string): string {
    return `${ReferenceScheme.GITHUB}://issue/${repo}/${issueNumber}`;
  }

  static githubPr(repo: string, prNumber: number | string): string {
    return `${ReferenceScheme.GITHUB}://pr/${repo}/${prNumber}`;
  }

  static gitCommit(sha: string): string {
    return `${ReferenceScheme.GIT}://commit/${sha}`;
  }

  static agentRun(actorId: string, executionId: string): string {
    return `${ReferenceScheme.AGENT}://${actorId}/run/${executionId}`;
  }

  static factoryWork(workId: string): string {
    return `${ReferenceScheme.FACTORY}://work/${workId}`;
  }

  static telegramMessage(chatId: string | number, messageId: string | number): string {
    return `${ReferenceScheme.TELEGRAM}://chat/${chatId}/message/${messageId}`;
  }

  static file(path: string): string {
    return `${ReferenceScheme.FILE}://${path}`;
  }
}
