/** Write `schemas/faces-1.schema.json`: the cross-language contract (Python or a server validates against it). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { FaceResult } from '../src/schema';

mkdirSync('schemas', { recursive: true });
const json = z.toJSONSchema(FaceResult, { target: 'draft-2020-12', io: 'input' });
writeFileSync('schemas/faces-1.schema.json', JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'faces/1 FaceResult', ...json }, null, 2) + '\n');
console.log('wrote schemas/faces-1.schema.json');
