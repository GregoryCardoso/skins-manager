'use strict';

const { Router } = require('express');
const controller = require('../controllers/importController');
const validateIdParam = require('../middlewares/validateIdParam');
const { requireJsonForWrites } = require('../middlewares/validationHelpers');
const { validateRunBody, validateUndoBody, validateBatchesQuery, validateEntriesQuery } = require('../middlewares/importValidators');

const router = Router();
router.use(requireJsonForWrites);

router.post('/csfloat/run', validateRunBody, controller.run);
router.get('/batches', validateBatchesQuery, controller.listBatches);
router.get('/batches/:id', validateIdParam, controller.getBatch);
router.get('/batches/:id/undo-preview', validateIdParam, controller.undoPreview);
router.post('/batches/:id/undo', validateIdParam, validateUndoBody, controller.undo);
router.get('/entries', validateEntriesQuery, controller.listEntries);

module.exports = router;
