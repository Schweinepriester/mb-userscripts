import { LOGGER } from '@lib/logging/logger';
import { ArtworkTypeIDs } from '@lib/MB/CoverArt';
import { assertDefined } from '@lib/util/assert';
import { safeParseJSON } from '@lib/util/json';
import { urlBasename, urlJoin } from '@lib/util/urls';
import { gmxhr } from '@lib/util/xhr';

import type { CoverArt } from './base';
import { CoverArtProvider } from './base';

// Incomplete.
interface ArchiveMetadata {
    server: string; // Server hostname on which the file is hosted
    dir: string; // Path to item on ^
    files: ArchiveFileMetadata[];
    is_dark?: true;
}

interface ArchiveFileMetadata {
    name: string;  // For files in subdirectories, this will contain the full path including directory paths.
    source: 'original' | 'derivative';
    format: string;
}

interface CAAIndex {
    images: Array<{
        comment: string;
        types: string[];
        id: string | number;  // Used to be string in the past, hasn't been applied retroactively yet, see CAA-129
        image: string;
    }>;
}

export class ArchiveProvider extends CoverArtProvider {
    supportedDomains = ['archive.org'];
    favicon = 'https://archive.org/images/glogo.jpg';
    name = 'Archive.org';
    urlRegex = /(?:details|metadata|download)\/([^/?#]+)/;

    static CAA_ITEM_REGEX = /^mbid-[a-f0-9-]+$/;
    static IMAGE_FILE_FORMATS = [
        'JPEG',
        'PNG',
        'Text PDF',  // TODO: Is there a non-text variant?
        'Animated GIF',  // TODO: Is there a non-animated variant?
    ];

    async findImages(url: URL): Promise<CoverArt[]> {
        const itemId = this.extractId(url);
        assertDefined(itemId);

        const itemMetadata = await this.getItemMetadata(itemId);
        const baseDownloadUrl = this.createBaseDownloadUrl(itemMetadata);

        if (ArchiveProvider.CAA_ITEM_REGEX.test(itemId)) {
            // For MB/CAA items, try to extract from the CAA index.json to
            // prevent grabbing images which have been unlinked from the
            // release, and to extract artwork type information.
            try {
                return await this.extractCAAImages(itemId, baseDownloadUrl);
            } catch {
                // pass, fall through to generic extraction
                // istanbul ignore next: difficult to cover.
                LOGGER.warn('Failed to extract CAA images, falling back on generic IA extraction');
            }
        }

        return this.extractGenericImages(itemMetadata, baseDownloadUrl);
    }

    /**
     * Entrypoint for MB/CAA providers to delegate to IA. Does not fall back
     * onto generic extraction.
     */
    async findImagesCAA(itemId: string): Promise<CoverArt[]> {
        const itemMetadata = await this.getItemMetadata(itemId);
        const baseDownloadUrl = this.createBaseDownloadUrl(itemMetadata);
        return this.extractCAAImages(itemId, baseDownloadUrl);
    }

    private async extractCAAImages(itemId: string, baseDownloadUrl: URL): Promise<CoverArt[]> {
        // Grabbing metadata through CAA isn't 100% reliable, since the info
        // in the index.json isn't always up-to-date (see CAA-129, only a few
        // cases though).
        const caaIndexUrl = `https://archive.org/download/${itemId}/index.json`;
        const caaIndexResp = await gmxhr(caaIndexUrl);
        const caaIndex = safeParseJSON<CAAIndex>(caaIndexResp.responseText, 'Could not parse index.json');

        return caaIndex.images.map((img) => {
            const imageFileName = urlBasename(img.image);
            return {
                url: urlJoin(baseDownloadUrl, `${itemId}-${imageFileName}`),
                comment: img.comment,
                types: img.types.map((type) => ArtworkTypeIDs[type as keyof typeof ArtworkTypeIDs]),
            };
        });
    }

    extractGenericImages(itemMetadata: ArchiveMetadata, baseDownloadUrl: URL): CoverArt[] {
        const originalImagePaths = itemMetadata.files
            .filter((file) => file.source === 'original' && ArchiveProvider.IMAGE_FILE_FORMATS.includes(file.format))
            .map((file) => file.name);

        return originalImagePaths.map((path) => {
            return {
                url: urlJoin(baseDownloadUrl, path),
            };
        });
    }

    private async getItemMetadata(itemId: string): Promise<ArchiveMetadata> {
        const itemMetadataResp = await this.fetchPage(new URL(`https://archive.org/metadata/${itemId}`));
        const itemMetadata = safeParseJSON<ArchiveMetadata>(itemMetadataResp, 'Could not parse IA metadata');

        // IA's metadata API always returns a 200, even for items which don't
        // exist.
        if (!itemMetadata.server) {
            throw new Error('Empty IA metadata, item might not exist');
        }

        if (itemMetadata.is_dark) {
            throw new Error('Cannot extract images: This item is darkened');
        }

        return itemMetadata;
    }

    private createBaseDownloadUrl(itemMetadata: ArchiveMetadata): URL {
        // While we could just use the standard archive.org/download/... URL,
        // it would always lead to redirection warnings which can be avoided.
        return urlJoin(`https://${itemMetadata.server}`, `${itemMetadata.dir}/`);
    }
}
