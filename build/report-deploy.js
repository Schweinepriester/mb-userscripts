/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Cannot fix this in JS code. */
/* eslint-disable @typescript-eslint/explicit-function-return-type -- These are present in JSDoc comments. */
/* eslint-disable @typescript-eslint/prefer-optional-chain -- Syntax not supported in github-script on CI. */

/**
 * Use JSDoc type defs to do type imports.
 * @typedef { import('./types-deploy').DeployInfo } DeployInfo
 * @typedef { import('./types-deploy').PullRequestInfo } PullRequestInfo
 * @typedef { import('./types-deploy').Octokit } Octokit
 * @typedef { import('./types-deploy').GithubActionsContext } GithubActionsContext
 */

/**
 * @return { Promise<void> }
 * @param { { github: Octokit; context: GithubActionsContext } } args
 */
async function reportDeploy({ github, context }) {
    const { TEST_RESULT, DEPLOY_RESULT } = process.env;

    if (!process.env.PR_INFO) {
        throw new Error('PR info not set, are we running in CI?');
    }

    /** @type PullRequestInfo */
    const prInfo = JSON.parse(process.env.PR_INFO);
    /** @type DeployInfo | null */
    const deployInfo = process.env.DEPLOY_INFO ? JSON.parse(process.env.DEPLOY_INFO) : null;

    // Set labels on PR
    /** @type string */
    // eslint-disable-next-line no-restricted-syntax
    let label;
    if (TEST_RESULT !== 'success' || DEPLOY_RESULT !== 'success') {
        label = 'deploy:failed';
    } else if (!deployInfo || !deployInfo.scripts.length) {
        label = 'deploy:skipped';
    } else {
        label = 'deploy:success';
    }
    await github.rest.issues.addLabels({
        issue_number: prInfo.number,
        owner: context.repo.owner,
        repo: context.repo.repo,
        labels: [label],
    });

    // Leave a comment is deployment succeeded or failed, but not if it was skipped.
    /** @type string | undefined */
    // eslint-disable-next-line no-restricted-syntax
    let issueComment;
    if (TEST_RESULT !== 'success' || DEPLOY_RESULT !== 'success') {
        // Warn if deployment is skipped due to failures
        const runUrl = `https://github.com/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;
        issueComment = [
            ':boom: Heads up! Automatic deployment of the changes in this PR failed! :boom:',
            `See [${context.workflow}#${context.runNumber}](${runUrl}).`,
        ].join('\n');
    } else if (deployInfo && deployInfo.scripts.length) {
        // Report deployed versions
        issueComment = [
            `:rocket: Released ${deployInfo.scripts.length} new userscript version(s):`,
        ].concat(deployInfo.scripts.map((script) => {
            return `* ${script.name} ${script.version} in ${script.commit}`;
        })).join('\n');
    }

    if (issueComment) {
        await github.rest.issues.createComment({
            issue_number: prInfo.number,
            owner: context.repo.owner,
            repo: context.repo.repo,
            body: issueComment,
        });
    }
}

/**
 * @return { Promise<void> }
 * @param { { github: Octokit; context: GithubActionsContext } } args
 */
async function reportPreview({ github, context }) {
    if (!process.env.PR_INFO) {
        throw new Error('PR info not set, are we running in CI?');
    }

    /** @type PullRequestInfo */
    const prInfo = JSON.parse(process.env.PR_INFO);
    /** @type DeployInfo | null */
    const deployInfo = process.env.DEPLOY_INFO ? JSON.parse(process.env.DEPLOY_INFO) : null;

    /** @type string */
    // eslint-disable-next-line no-restricted-syntax
    let content;
    if (!deployInfo || !deployInfo.scripts.length) {
        content = 'This PR makes no changes to the built userscripts.';
    } else {
        const basePreviewUrl = `https://raw.github.com/${context.repo.owner}/${context.repo.repo}/dist-preview-${prInfo.number}`;
        const diffUrl = `https://github.com/${context.repo.owner}/${context.repo.repo}/compare/dist...dist-preview-${prInfo.number}`;
        content = [
            `This PR changes ${deployInfo.scripts.length} built userscript(s):`,
        ].concat(deployInfo.scripts.map((script) => {
            const previewUrl = basePreviewUrl + '/' + script.name + '.user.js';
            return `* \`${script.name}\` ([install preview](${previewUrl}), changes: ${script.commit})`;
        })).concat([
            '',
            `[See all changes](${diffUrl})`,
        ]).join('\n');
    }

    const existingComments = await github.rest.issues.listComments({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: prInfo.number,
        per_page: 100, // Will we ever go over 100 comments on a PR? We'll have to paginate then.
    });
    const existingBotCommentIds = existingComments.data
        .filter((comment) => comment.user.login === 'github-actions[bot]')
        .map((comment) => comment.id);

    if (existingBotCommentIds.length) {
        const commentId = existingBotCommentIds[existingBotCommentIds.length - 1];
        await github.rest.issues.updateComment({
            owner: context.repo.owner,
            repo: context.repo.repo,
            comment_id: commentId,
            body: content,
        });
    } else {
        await github.rest.issues.createComment({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: prInfo.number,
            body: content,
        });
    }
}


module.exports = {
    reportDeploy,
    reportPreview,
};
