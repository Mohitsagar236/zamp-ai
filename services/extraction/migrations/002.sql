-- Preserve completed results and operation replay across extractor upgrades.
ALTER TABLE extraction_cache ADD COLUMN extractor_version text NOT NULL DEFAULT 'label-parser/2.0';
ALTER TABLE extraction_results ADD COLUMN extractor_version text NOT NULL DEFAULT 'label-parser/2.0';
ALTER TABLE extraction_operations ADD COLUMN extractor_version text NOT NULL DEFAULT 'label-parser/2.0';
ALTER TABLE extraction_results DROP CONSTRAINT extraction_results_hash_fkey;
ALTER TABLE extraction_operations DROP CONSTRAINT extraction_operations_hash_fkey;
ALTER TABLE extraction_results DROP CONSTRAINT extraction_results_pkey;
ALTER TABLE extraction_cache DROP CONSTRAINT extraction_cache_pkey;
ALTER TABLE extraction_cache ADD PRIMARY KEY(hash,extractor_version);
ALTER TABLE extraction_results ADD PRIMARY KEY(hash,extractor_version);
ALTER TABLE extraction_results ADD FOREIGN KEY(hash,extractor_version) REFERENCES extraction_cache(hash,extractor_version);
ALTER TABLE extraction_operations ADD FOREIGN KEY(hash,extractor_version) REFERENCES extraction_cache(hash,extractor_version);
