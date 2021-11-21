import fs from 'fs/promises';
import Helper from '@codeceptjs/helper';
import { retryTimes } from '../../../src/lib/util/async';

async function installViolentmonkeyScripts(vmBaseUrl: string, browser: WebdriverIO.BrowserObject): Promise<void> {
    // To install scripts in VM, there are a number of different options.
    // One is to navigate the browser to the userscript URL on the userscript
    // server, however, this breaks in Firefox, as this will hang the driver.
    // This is potentially related to https://bugzilla.mozilla.org/show_bug.cgi?id=1418273
    // as VM intercepts the page load to displays its installation page.
    //
    // Another option is to open the VM page and call some JS function through
    // browser.executeScript, however, VM's source is webpacked, so retrieving
    // those functions is impossible.
    //
    // Thirdly, we could open the "New userscript" dialog and paste the sources
    // in, but that could be slow and is somewhat tricky.
    //
    // The option we're going with is to use automating the browser through
    // "Install from URL".

    await browser.navigateTo(vmBaseUrl + '/options/index.html');

    for (const userscriptName of await fs.readdir('./dist')) {
        if (!userscriptName.endsWith('.user.js')) continue;

        // Open the dropdown menu
        const dropdownButton = await browser.$('.vl-dropdown-toggle');
        await dropdownButton.click();

        // Open the install from URL dialog
        const importFromUrlAnchor = await browser.$('a=Install from URL');
        await importFromUrlAnchor.click();

        // Enter the URL and submit
        const urlInput = await browser.$('.vl-modal input');
        // On Chrome, we don't seem to be able to set the value immediately, possibly
        // because of the animation of the dialog. We can't really wait for that to
        // be done, so retry on failure.
        await retryTimes(() => urlInput.setValue(`http://userscriptserver/${userscriptName}`), 5, 100);
        const submitButton = await browser.$('button=OK');
        await submitButton.click();

        // Switch to the newly-opened window. We may need to wait until the window is opened.
        await browser.waitUntil(async () => (await browser.getWindowHandles()).length > 1);
        await browser.switchWindow(new RegExp(`^${vmBaseUrl}/confirm/index\\.html`));

        // Need to wait until the button becomes clickable.
        const installButton = await browser.$('button=Confirm installation');
        await installButton.waitForEnabled({
            timeout: 30000,
        });
        await installButton.click();

        // Close the installation page and switch back to the original page.
        await browser.closeWindow();
        await browser.switchWindow(/./);
    }
}

module.exports = class UserscriptInstaller extends Helper {
    alreadyRan = false;

    override async _before(): Promise<void> {
        const { WebDriver } = this.helpers;
        // If the browser doesn't get restarted between tests and we already
        // installed the userscripts, then we don't need to do it again.
        if (!WebDriver.options.restart && this.alreadyRan) return;

        const browser: WebdriverIO.BrowserObject = WebDriver.browser;
        // @ts-expect-error incomplete declarations
        const config = this.config;
        const addonBaseUrl: string = config.userscriptManagerBaseUrl;
        const userscriptManagerName: string = config.userscriptManagerName;

        switch(userscriptManagerName) {
        case 'violentmonkey':
            await installViolentmonkeyScripts(addonBaseUrl, browser);
            break;
        default:
            throw new Error('Unsupported userscript manager: ' + userscriptManagerName);
        }

        this.alreadyRan = true;
    }
};
