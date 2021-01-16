/*
 * Copyright 2020 Spotify AB
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { ConfigReader } from '@backstage/config';
import { msw } from '@backstage/test-utils';
import fs from 'fs';
import { rest } from 'msw';
import { setupServer } from 'msw/node';
import path from 'path';
import { GithubUrlReader } from './GithubUrlReader';
import { ReadTreeResponseFactory } from './tree';

const treeResponseFactory = ReadTreeResponseFactory.create({
  config: new ConfigReader({}),
});

describe('GithubUrlReader', () => {
  describe('implementation', () => {
    it('rejects unknown targets', async () => {
      const processor = new GithubUrlReader(
        {
          host: 'github.com',
          apiBaseUrl: 'https://api.github.com',
        },
        { treeResponseFactory },
      );
      await expect(
        processor.read('https://not.github.com/apa'),
      ).rejects.toThrow(
        'Incorrect URL: https://not.github.com/apa, Error: Invalid GitHub URL or file path',
      );
    });
  });

  describe('readTree', () => {
    const worker = setupServer();

    msw.setupDefaultHandlers(worker);

    const repoBuffer = fs.readFileSync(
      path.resolve('src', 'reading', '__fixtures__', 'mock-main.tar.gz'),
    );

    const reposGitHubApiResponse = {
      id: '123',
      full_name: 'backstage/mock',
      default_branch: 'main',
      branches_url:
        'https://api.github.com/repos/backstage/mock/branches{/branch}',
    };

    const reposGheApiResponse = {
      ...reposGitHubApiResponse,
      branches_url:
        'https://ghe.github.com/api/v3/repos/backstage/mock/branches{/branch}',
    };

    const branchesApiResponse = {
      name: 'main',
      commit: {
        sha: '123abc',
      },
    };

    beforeEach(() => {
      worker.use(
        rest.get(
          'https://github.com/backstage/mock/archive/main.tar.gz',
          (_, res, ctx) =>
            res(
              ctx.status(200),
              ctx.set('Content-Type', 'application/x-gzip'),
              ctx.body(repoBuffer),
            ),
        ),
      );

      worker.use(
        rest.get('https://api.github.com/repos/backstage/mock', (_, res, ctx) =>
          res(
            ctx.status(200),
            ctx.set('Content-Type', 'application/json'),
            ctx.json(reposGitHubApiResponse),
          ),
        ),
      );

      worker.use(
        rest.get(
          'https://api.github.com/repos/backstage/mock/branches/main',
          (_, res, ctx) =>
            res(
              ctx.status(200),
              ctx.set('Content-Type', 'application/json'),
              ctx.json(branchesApiResponse),
            ),
        ),
      );
    });

    it('returns the wanted files from an archive', async () => {
      const processor = new GithubUrlReader(
        {
          host: 'github.com',
          apiBaseUrl: 'https://api.github.com',
        },
        { treeResponseFactory },
      );

      const response = await processor.readTree(
        'https://github.com/backstage/mock/tree/main',
      );

      expect(response.sha).toBe('123abc');

      const files = await response.files();

      expect(files.length).toBe(2);
      const mkDocsFile = await files[0].content();
      const indexMarkdownFile = await files[1].content();

      expect(mkDocsFile.toString()).toBe('site_name: Test\n');
      expect(indexMarkdownFile.toString()).toBe('# Test\n');
    });

    it('includes the subdomain in the github url', async () => {
      worker.resetHandlers();
      worker.use(
        rest.get(
          'https://ghe.github.com/backstage/mock/archive/main.tar.gz',
          (_, res, ctx) =>
            res(
              ctx.status(200),
              ctx.set('Content-Type', 'application/x-gzip'),
              ctx.body(repoBuffer),
            ),
        ),
      );

      worker.use(
        rest.get(
          'https://ghe.github.com/api/v3/repos/backstage/mock',
          (_, res, ctx) =>
            res(
              ctx.status(200),
              ctx.set('Content-Type', 'application/json'),
              ctx.json(reposGheApiResponse),
            ),
        ),
      );

      worker.use(
        rest.get(
          'https://ghe.github.com/api/v3/repos/backstage/mock/branches/main',
          (_, res, ctx) =>
            res(
              ctx.status(200),
              ctx.set('Content-Type', 'application/json'),
              ctx.json(branchesApiResponse),
            ),
        ),
      );

      const processor = new GithubUrlReader(
        {
          host: 'ghe.github.com',
          apiBaseUrl: 'https://ghe.github.com/api/v3',
        },
        { treeResponseFactory },
      );

      const response = await processor.readTree(
        'https://ghe.github.com/backstage/mock/tree/main/docs',
      );

      const files = await response.files();

      expect(files.length).toBe(1);
      const indexMarkdownFile = await files[0].content();

      expect(indexMarkdownFile.toString()).toBe('# Test\n');
    });

    it('returns the wanted files from an archive with a subpath', async () => {
      const processor = new GithubUrlReader(
        {
          host: 'github.com',
          apiBaseUrl: 'https://api.github.com',
        },
        { treeResponseFactory },
      );

      const response = await processor.readTree(
        'https://github.com/backstage/mock/tree/main/docs',
      );

      const files = await response.files();

      expect(files.length).toBe(1);
      const indexMarkdownFile = await files[0].content();

      expect(indexMarkdownFile.toString()).toBe('# Test\n');
    });
  });
});
