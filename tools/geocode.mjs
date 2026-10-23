// Fills data/geocache.json for every mappable Greater Lowell address. Run before tools/build-data.mjs.
import { readRegistry } from './registry.mjs';
import { geocodeMissing } from './geocoder.mjs';

await geocodeMissing(readRegistry(), 'MA');
