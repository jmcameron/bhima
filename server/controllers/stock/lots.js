/**
 * @module lots
 *
 *
 * @description
 * The /lots HTTP API endpoint
 *
 * @requires lodash
 * @requires moment
 * @requires lib/db
 * @requires lib/filter
 */

const path = require('path');
const _ = require('lodash');
const fs = require('fs');
const converter = require('json-2-csv');
const tempy = require('tempy');
const debug = require('debug')('bhima:stock:lots');
const moment = require('moment');

const { render } = require('@ima-worldhealth/coral');
const AdmZip = require('adm-zip');

const html = require('../../lib/renderers/html');
const db = require('../../lib/db');
const barcode = require('../../lib/barcode');
const util = require('../../lib/util');
const FilterParser = require('../../lib/filter');
const identifiers = require('../../config/identifiers');
const core = require('./core');

const detailsQuery = `
  SELECT
    BUID(l.uuid) AS uuid, l.label, l.quantity, l.unit_cost, l.expiration_date,
    l.reference_number, l.serial_number, l.acquisition_date, l.package_size,
    (SELECT MIN(sm.date) FROM stock_movement sm
     WHERE sm.lot_uuid = l.uuid) AS entry_date,
    BUID(i.uuid) AS inventory_uuid, i.text as inventory_name,
    i.code as inventory_code, i.is_asset, i.is_count_per_container,
    fs.label AS funding_source_label, fs.code AS funding_source_code,
    BUID(fs.uuid) AS funding_source_uuid 
  FROM lot l
  JOIN inventory i ON i.uuid = l.inventory_uuid
  LEFT JOIN funding_source fs ON fs.uuid = l.funding_source_uuid
  `;

exports.create = create;
exports.update = update;
exports.details = details;
exports.getLotTags = getLotTags;
exports.getCandidates = getCandidates;
exports.getLotsUsageSchedule = getLotsUsageSchedule;
exports.getDupes = getDupes;
exports.getAllDupes = getAllDupes;
exports.merge = merge;
exports.autoMerge = autoMerge;
exports.autoMergeZero = autoMergeZero;
exports.generateBarcodes = generateBarcodes;

function getLotTags(bid) {
  const queryTags = `
    SELECT BUID(t.uuid) uuid, t.name, t.color
    FROM tags t
    JOIN lot_tag lt ON lt.tag_uuid = t.uuid
    WHERE lt.lot_uuid = ?
  `;
  return db.exec(queryTags, [bid]);
}

/**
 * POST /stock/lots/create
 * Create new lots
 */
async function create(req, res) {
  const params = req.body;
  const tx = db.transaction();
  const sql = `INSERT IGNORE INTO lot SET ?;`;

  const lots = params.lots || [];

  lots.forEach(lot => {
    const value = {
      uuid : db.bid(lot.uuid) || db.bid(util.uuid()),
      label : lot.label,
      quantity : lot.quantity,
      unit_cost : lot.unit_cost,
      description : lot.description,
      expiration_date : lot.expiration_date,
      inventory_uuid : db.bid(lot.inventory_uuid),
      is_assigned : lot.is_assigned || 0,
      reference_number : lot.reference_number || '',
      serial_number : lot.serial_number || '',
      acquisition_date : lot.acquisition_date || null,
      package_size : lot.package_size || 1,
      funding_source_uuid : lot.funding_source_uuid ? db.bid(lot.funding_source_uuid) : null,
    };
    tx.addQuery(sql, value);
  });

  await tx.execute();
  res.status(201).json({});
}

/**
 * GET /stock/lots/:uuid
 * Get details of a lot
 */
async function details(req, res) {
  const bid = db.bid(req.params.uuid);
  const info = await db.one(`${detailsQuery} WHERE l.uuid = ?`, [bid]);
  info.tags = await getLotTags(bid);
  res.status(200).json(info);
}

/**
 * PUT /stock/lots/:uuid
 * Edit a stock lot
 */
async function update(req, res, next) {
  const bid = db.bid(req.params.uuid);

  const allowedToEdit = [
    'label', 'expiration_date', 'unit_cost', 'reference_number',
    'serial_number', 'acquisition_date', 'package_size', 'funding_source_uuid',
  ];

  const params = _.pick(req.body, allowedToEdit);
  const { tags } = req.body;

  db.convert(params, ['funding_source_uuid']);

  if (params.expiration_date) {
    params.expiration_date = moment(params.expiration_date).format('YYYY-MM-DD');
  }

  if (params.acquisition_date) {
    params.acquisition_date = moment(params.acquisition_date).format('YYYY-MM-DD');
  }

  try {
    await db.exec('UPDATE lot SET ? WHERE uuid = ?', [params, bid]);

    if (tags) {
      // update tags
      const transaction = db.transaction();
      transaction.addQuery('DELETE FROM lot_tag WHERE lot_uuid = ?', [bid]);
      tags.forEach(t => {
        const binaryTagUuid = db.bid(t.uuid);
        transaction.addQuery('INSERT INTO lot_tag(lot_uuid, tag_uuid) VALUES (?, ?);', [bid, binaryTagUuid]);
      });
      await transaction.execute();
    }

    res.sendStatus(200);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /inventory/:uuid/lot_candidates
 *
 * @description
 * Returns all lots with the that inventory uuid
 */
async function getCandidates(req, res) {
  const inventoryUuid = db.bid(req.params.uuid);

  const query = `
    SELECT BUID(l.uuid) AS uuid, l.label, l.expiration_date,
      l.reference_number, l.serial_number, l.package_size, l.acquisition_date,
      fs.label AS funding_source_label, fs.code AS funding_source_code,
      BUID(fs.uuid) AS funding_source_uuid 
    FROM lot l 
      LEFT JOIN funding_source fs ON fs.uuid = l.funding_source_uuid
    WHERE l.inventory_uuid = ?
    ORDER BY label, expiration_date
  `;

  const rows = await db.exec(query, [inventoryUuid]);
  res.status(200).json(rows);
}

async function getLotsUsageSchedule(req, res) {
  // Get the raw lots data for this inventory/depot combo
  const params = {
    inventory_uuid : req.params.uuid,
    depot_uuid : req.params.depotUuid,
    month_average_consumption :
      req.query.month_average_consumption || req.session.stock_settings.month_average_consumption,
    average_consumption_algo :
      req.query.average_consumption_algo || req.session.stock_settings.average_consumption_algo,
  };

  // Number of months that the call will cover
  const numMonths = req.query.interval_num_months || 6;

  let lots;

  const rawLots = await core.getLotsDepot(null, params);

  if (rawLots.length > 0) {
    const today = new Date();

    // Get the average consumption (note that this lot may be purged below)
    const avgConsumption = rawLots[0].avg_consumption;

    // We need to eliminate any exhausted lots and any expired lots
    lots = rawLots.filter(lot => lot.quantity > 0)
      .filter(lot => moment(new Date(lot.expiration_date)) >= moment(today));

    // runningDate is the date the last lot ran out
    // (Always start the first lot 00:00 AM of current date; ignore the past)
    let runningDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    lots.forEach(lot => {
      // Process the lots and determine sequential start/end dates and other info
      lot.start_date = new Date(runningDate);
      lot.expiration_date = new Date(lot.expiration_date);

      // Compute when the lot runs out (based on adjusted start date)
      if (avgConsumption > 0) {
        // Calculate in days since moment.add does not handle fractional months
        // NB: Since moment.diff silently truncates its arguments, even this
        //     calculation will include some round-off errors.
        lot.exhausted_date = moment(lot.start_date).add(30.5 * (lot.quantity / avgConsumption), 'days').toDate();
      } else {
        lot.exhausted_date = moment(lot.start_date).add(numMonths, 'months').toDate();
      }

      // Compute the end date for this lot
      lot.end_date = new Date(lot.exhausted_date);
      lot.premature_expiration = false;
      const daysResidual = moment(lot.exhausted_date).diff(moment(lot.expiration_date), 'days');
      if (daysResidual > 0) {
        lot.end_date = lot.expiration_date;
        lot.premature_expiration = true;
      }

      // Compute the starting value (assume enterprise currency)
      lot.value = lot.quantity * lot.unit_cost;

      // Compute the lot quantity that will be left at the end date
      lot.num_days = moment(lot.end_date).diff(moment(lot.start_date), 'days');
      lot.num_months = lot.num_days / 30.5;

      // If we do not expire before exhaustion, assume all stock articles are used.
      // Otherwise, do the calculation to estimate how many will be wasted
      const numUsed = lot.premature_expiration ? Math.ceil(lot.num_months * avgConsumption) : lot.quantity;
      lot.quantity_used = Math.min(numUsed, lot.quantity); // Cannot use more than we have!
      lot.quantity_wasted = lot.quantity - lot.quantity_used;
      lot.value_wasted = lot.quantity_wasted * lot.unit_cost;

      // Adjust the running date (the next lot will start at this date)
      runningDate = lot.end_date;
    });
  }
  res.status(200).json(lots);
}

/**
 * GET /lots_dupes
 *
 *
 * @description
 * Returns all duplicated lots with the given label or matching field(s)
 * inventory_uuid, entry_date, expiration_date.
 * :label?/:inventory_uuid?/:entry_date?/:expiration_date?
 */
async function getDupes(req, res) {
  const options = db.convert(req.query, ['inventory_uuid']);
  const filters = new FilterParser(options, { tableAlias : 'l' });

  filters.equals('label');
  filters.equals('inventory_uuid');
  filters.equals('entry_date');
  filters.equals('expiration_date');
  filters.fullText('reference_number');
  filters.equals('serial_number');
  filters.equals('acquisition_date');

  const query = filters.applyQuery(detailsQuery);
  const params = filters.parameters();

  const rows = await db.exec(query, params);
  res.status(200).json(rows);
}

/**
 * GET /lots_all_dupes
 *
 * @description
 * Returns all lots with duplicates
 */
async function getAllDupes(req, res) {
  const sql = `
  WITH lot_stats AS (
    SELECT 
      l.uuid,
      l.label,
      l.unit_cost,
      l.expiration_date,
      l.inventory_uuid,
      inv.code AS inventory_code,
      inv.text AS inventory_name,
      COUNT(*) OVER (PARTITION BY l.inventory_uuid, l.label) AS num_duplicates
    FROM lot l
      JOIN inventory inv ON l.inventory_uuid = inv.uuid
  ),
  lot_movements AS (
    SELECT 
      ANY_VALUE(ls.uuid) AS uuid,
      ls.label,
      ANY_VALUE(ls.unit_cost) as unit_cost,
      ls.expiration_date,
      ls.inventory_uuid,
      ls.inventory_code,
      ls.inventory_name,
      ls.num_duplicates,
      MIN(sm.date) AS entry_date,
      SUM(sm.quantity * IF(sm.is_exit = 1, -1, 1)) AS quantity_in_stock
    FROM lot_stats ls
      LEFT JOIN stock_movement sm ON sm.lot_uuid = ls.uuid
    WHERE ls.num_duplicates > 1
    GROUP BY ls.label, ls.expiration_date, ls.inventory_uuid, ls.num_duplicates
  )
  SELECT 
    BUID(lm.uuid) AS uuid,
    lm.label,
    lm.unit_cost,
    lm.expiration_date,
    lm.entry_date,
    lm.inventory_code,
    lm.inventory_name,
    lm.inventory_uuid,
    lm.num_duplicates,
    lm.quantity_in_stock,
    MAX(lm.quantity_in_stock) OVER (PARTITION BY lm.inventory_uuid, lm.label) AS max_quantity
  FROM lot_movements lm
  ORDER BY lm.inventory_name, lm.num_duplicates, lm.label;
`;

  debug('Looking up duplicate lots...');
  const rows = await db.exec(sql, []);
  debug(`Found ${rows.length} duplicate lots.`);

  res.status(200).json(rows);
}

/**
 * Internal function to merge lots
 * @description
 * Merge the lotsToMerge into the lot to keep (given by uuid).
 * This is a accomplished in two steps for each lot to merge:
 *   1. Replace all references to the lot to be merged with
 *      references to the lot to keep.
 *   2. Delete the lot to be merged
 *
 * @param uuid {string} UUID of the primary lot to keep
 * @param lotsToMerge {list} UUIDs (strings) for lots to be merged into the primary lot
 *
 * @return a promise for the DB transaction
 */

function mergeLotsInternal(uuid, lotsToMerge) {
  const keepLotUuid = db.bid(uuid);

  const updateLotTags = 'UPDATE lot_tag SET lot_uuid = ? WHERE lot_uuid = ?';
  const updateStockAssign = 'UPDATE stock_assign SET lot_uuid = ? WHERE lot_uuid = ?';
  const updateStockMovement = 'UPDATE stock_movement SET lot_uuid = ? WHERE lot_uuid = ?';
  const updateShipmentTable = 'UPDATE shipment_item SET lot_uuid = ? WHERE lot_uuid = ?';
  const deleteLot = 'DELETE FROM lot WHERE uuid = ?';

  const transaction = db.transaction();

  lotsToMerge.forEach(rawUuid => {
    const mergeLotUuid = db.bid(rawUuid);
    transaction.addQuery(updateLotTags, [keepLotUuid, mergeLotUuid]);
    transaction.addQuery(updateStockAssign, [keepLotUuid, mergeLotUuid]);
    transaction.addQuery(updateStockMovement, [keepLotUuid, mergeLotUuid]);
    transaction.addQuery(updateShipmentTable, [keepLotUuid, mergeLotUuid]);
    transaction.addQuery(deleteLot, [mergeLotUuid]);
  });

  return transaction.execute();
}

/**
 * GET /lots/:uuid/merge
 *
 * @description
 * Merge the lots_to_merge (in the body) into the lot to keep (given by uuid).
 * This is a accomplished in two steps for each lot to merge:
 *   1. Replace all references to the lot to be merged with
 *      references to the lot to keep.
 *   2. Delete the lot to be merged
 */
async function merge(req, res) {
  const { uuid } = req.params;

  debug(`#merge(): merging ${req.body.lotsToMerge.length} lots into ${uuid}.`);

  const lotsToMerge = req.body.lotsToMerge.map(db.bid);

  await mergeLotsInternal(uuid, lotsToMerge);
  res.sendStatus(200);
}

/**
 * GET /lots/merge/auto
 *
 * @description
 * Finds and merges all lots suitable for automatic merging
 *  - To qualify, the lots must have the same inventory_uuid,
 *    label, and expiration date.
 */
async function autoMerge(req, res) {
  // The first query gets the inventory UUID for each
  // inventory article with duplicate lots (having the
  // same label, inventory_uuid, and expiration_date).
  // (Since these are grouped, only one of the several
  // lots is given.)
  const query1 = `
    SELECT
      BUID(l.uuid) AS uuid, l.label, l.expiration_date,
      l.reference_number, l.serial_number, l.acquisition_date, l.package_size,
      BUID(i.uuid) AS inventory_uuid, i.text as inventory_name,
      COUNT(*) as num_duplicates
    FROM lot l
      JOIN inventory i ON i.uuid = l.inventory_uuid
    GROUP BY label, inventory_uuid, expiration_date HAVING num_duplicates > 1
  `;

  // The second query gets all lots matching the label,
  // inventory_uuid, and expiration dates
  const query2 = `
    SELECT
      BUID(l.uuid) AS uuid, l.label, l.expiration_date,
      l.reference_number, l.serial_number,
      BUID(i.uuid) AS inventory_uuid, i.text as inventory_name,
      l.acquisition_date
    FROM lot l
      JOIN inventory i ON i.uuid = l.inventory_uuid
    WHERE l.label=? AND i.uuid=? AND l.expiration_date=DATE(?)
  `;

  debug(`Looking up lots to automatically merge.`);

  const rows = await db.exec(query1, []);

  const numInventories = rows.length;
  const numLots = rows.reduce((sum, row) => sum + row.num_duplicates, 0) - numInventories;

  debug(`Located ${numInventories} inventory items with duplicate lots.`);
  debug(`A total of ${numLots} duplicate lots will be merged.`);

  const promises = rows.map(row => {
    return db.exec(query2, [row.label, db.bid(row.inventory_uuid), row.expiration_date])
      .then((lots) => {
        // Arbitrarily keep the first lot and merge the duplicates into it
        const keepLotUuid = lots[0].uuid;
        const lotUuids = lots.slice(1).map(lot => lot.uuid);
        return mergeLotsInternal(keepLotUuid, lotUuids);
      });
  });

  await Promise.all(promises);
  res.status(200).json({ numInventories, numLots });

}

/**
 * GET /lots/merge/autoZero
 *
 * @description
 * Finds and merges all lots with zero quantity in stock
 */
async function autoMergeZero(req, res) {
  // Create a temporary table with quantity-in-stock sums for all duplicate lots
  const query1 = `
    CREATE TEMPORARY TABLE tmp_dupe_lots AS
    SELECT
      lot1.uuid, expiration_date,
      inv.code as code, inv.text AS inventory_name, inventory_uuid,
      (SELECT SUM(sm.quantity * IF(sm.is_exit = 1, -1, 1))
       FROM stock_movement sm WHERE sm.lot_uuid = lot1.uuid) AS quantity_in_stock,
      (SELECT COUNT(lot2.uuid) FROM lot lot2 WHERE lot2.inventory_uuid = lot1.inventory_uuid) as num_duplicates
    FROM lot lot1
    JOIN inventory as inv ON lot1.inventory_uuid=inv.uuid
    ORDER BY inventory_uuid,expiration_date;
  `;

  // Create a temporary table with max quantity-in-stock for all lots for each inventory_uuid
  const query2 = `
    CREATE TEMPORARY TABLE tmp_max_quantities AS
    SELECT
      uuid, expiration_date,
      code, inventory_name, inventory_uuid, num_duplicates,
      MAX(quantity_in_stock) OVER (PARTITION BY inventory_uuid) AS max_quantity
    FROM tmp_dupe_lots lot1
    WHERE num_duplicates > 1
    ORDER BY num_duplicates;
  `;

  // Reduce the entries to those with no quantity-in-stock and pick the one
  // with the newest expiration date
  const query3 = `
    SELECT
      HEX(lot1.uuid) AS uuid, lot1.expiration_date, code,
      inventory_name, lot1.inventory_uuid, max_quantity, num_duplicates
    FROM tmp_max_quantities lot1
    INNER JOIN (
        SELECT inventory_uuid, MAX(expiration_date) AS expiration_date
        FROM lot
        GROUP BY inventory_uuid
    ) lot2 ON lot1.inventory_uuid = lot2.inventory_uuid AND lot1.expiration_date = lot2.expiration_date
    WHERE max_quantity = 0
    GROUP BY lot1.inventory_uuid;
  `;

  // This query gets all UUIDs for all lots with the given inventory_uuid
  const getLotsSQL = 'SELECT BUID(uuid) AS uuid FROM lot WHERE inventory_uuid = ? AND uuid <> ?';

  const transaction = db.transaction();
  transaction.addQuery(query1);
  transaction.addQuery(query2);
  transaction.addQuery(query3);

  const txresults = await transaction.execute();

  const rows = txresults[2];
  const numLots = rows.length;

  const dbPromises = rows.map(row => {
    const keepLotUuid = row.uuid;
    // Get the lots associated with this inventory, excluding the lot to keep
    return db.exec(getLotsSQL, [db.bid(row.inventory_uuid), db.bid(keepLotUuid)])
      .then(lots => {
        const lotUuids = lots.map(elt => elt.uuid);
        // Merge the other lots into keepLotUuid
        return mergeLotsInternal(keepLotUuid, lotUuids);
      });
  });

  await Promise.all(dbPromises);

  res.status(200).json({ numLots });
}

/**
 * GET /lots/generate_barcodes/:number
 *
 * @description
 * Returns generated barcodes in a zip file
 */
async function generateBarcodes(req, res) {

  const totalBarcodes = req.params.number;
  const { key } = identifiers.LOT;
  const barcodeList = [];

  for (let i = 0; i < totalBarcodes; i++) {
    barcodeList.push({ barcode : barcode.generate(key, util.uuid()) });
  }

  // create the csv file of tag numbers
  const data = await converter.json2csv(barcodeList, { trimHeaderFields : true, trimFieldValues : true });
  const tmpCsvFile = tempy.file({ name : 'barcodes.csv' });
  await fs.promises.writeFile(tmpCsvFile, data);

  // create the pdf file of tag numbers
  const pdfTickets = await genPdfTickets(barcodeList);
  const tmpPdfFile = path.join(pdfTickets.path);

  // create a zip file for the csv and pdf files
  const zipped = await zipFiles(tmpCsvFile, tmpPdfFile);
  res.download(zipped);

}

async function genPdfTickets(barcodeList) {
  const context = { barcodeList };
  const tmpDocumentsFile = tempy.file({ name : `barcodes.pdf` });
  const template = './server/controllers/stock/reports/asset_barcodes.handlebars';

  const options = { path : tmpDocumentsFile, scale : 1 };

  const inlinedHtml = await html.render(context, template, options);
  const pdf = await render(inlinedHtml.trim(), options);
  return { file : pdf, path : tmpDocumentsFile };
}

async function zipFiles(...files) {
  const zip = new AdmZip();
  const outputFile = tempy.file({ name : `Barcodes for Tag Number in CSV+PDF.zip` });
  files.forEach(file => {
    zip.addLocalFile(file);
  });
  zip.writeZip(outputFile);
  await Promise.all(files.map((file) => fs.promises.unlink(file)));
  return outputFile;
}
