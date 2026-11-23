'use strict';

const { Router } = require('express');
const controller = require('../controllers/importController');
const validateIdParam = require('../middlewares/validateIdParam');
const { requireJsonForWrites } = require('../middlewares/validationHelpers');
const {
  validateRunBody, validateUndoBody, validateResolveBody, validateBulkResolveBody, validateEmptyBody, validateBatchesQuery, validateEntriesQuery,
  validateChangeCutoffBody, validateCutoffPreviewQuery,
} = require('../middlewares/importValidators');

const router = Router();
router.use(requireJsonForWrites);

router.post('/csfloat/run', validateRunBody, controller.run);
router.get('/csfloat/cutoff-preview', validateCutoffPreviewQuery, controller.cutoffPreview);
router.post('/csfloat/change-cutoff', validateChangeCutoffBody, controller.changeCutoff);
router.get('/batches', validateBatchesQuery, controller.listBatches);
router.get('/batches/:id', validateIdParam, controller.getBatch);
router.get('/batches/:id/undo-preview', validateIdParam, controller.undoPreview);
router.post('/batches/:id/undo', validateIdParam, validateUndoBody, controller.undo);
router.get('/entries', validateEntriesQuery, controller.listEntries);
router.post('/entries/bulk-resolve', validateBulkResolveBody, controller.bulkResolve); // antes de /:id
router.post('/entries/:id/resolve', validateIdParam, validateResolveBody, controller.resolveEntry);
router.post('/entries/:id/reopen', validateIdParam, validateEmptyBody, controller.reopenEntry);

module.exports = router;
