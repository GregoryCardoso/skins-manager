'use strict';

// Lista ordenada de migrações (D69). A lista só cresce; migração publicada nunca é editada.
const v001 = require('./v001_initial');
const v002 = require('./v002_catalog');
const v003 = require('./v003_manual_net');
const v004 = require('./v004_stores_settings');
const v005 = require('./v005_fx_sources');
const v006 = require('./v006_withdrawal_fee_sale_hold');
const v007 = require('./v007_store_currency_flows');
const v008 = require('./v008_computed_store_balance');
const v009 = require('./v009_remove_initial_balance');
const v010 = require('./v010_off_sale');
const v011 = require('./v011_inventory_view');
const v012 = require('./v012_integrations');
const v013 = require('./v013_imports');
const v014 = require('./v014_sale_release_at');
const v015 = require('./v015_batch_previous_cutoff');
const v016 = require('./v016_deposit_fee');
const v017 = require('./v017_item_components');
const v018 = require('./v018_component_slots_and_batch_counts');
const v019 = require('./v019_consumed_generated_patch');
const v020 = require('./v020_steam_store');
const v021 = require('./v021_market_prices');
const v022 = require('./v022_operation_ended_by');
const v023 = require('./v023_language_format');
const v024 = require('./v024_fx_rates_display_currency');
const v025 = require('./v025_store_currencies');
const v026 = require('./v026_catalog_item_names');
const v027 = require('./v027_inventory_density');

const MIGRATIONS = Object.freeze([v001, v002, v003, v004, v005, v006, v007, v008, v009, v010, v011, v012, v013, v014, v015, v016, v017, v018, v019, v020, v021, v022, v023, v024, v025, v026, v027]);

module.exports = { MIGRATIONS };
