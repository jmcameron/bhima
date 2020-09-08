const GU = require('../shared/GridUtils');
const helpers = require('../shared/helpers');
const SearchModal = require('../shared/search.page');
const Filters = require('../shared/components/bhFilters');

module.exports = StockLotsRegistryTests;

function StockLotsRegistryTests() {
  let modal;
  let filters;

  // navigate to the page
  before(() => helpers.navigate('#/stock/lots'));

  beforeEach(async () => {
    await SearchModal.open();
    modal = new SearchModal('stock-lots-search');
    filters = new Filters();
  });

  afterEach(async () => {
    await filters.resetFilters();
  });

  const gridId = 'stock-lots-grid';
  const LOT_FOR_ALLTIME = 19;
  const GROUPING_ROW = 1;

  it(`finds ${LOT_FOR_ALLTIME} lots for all time`, async () => {
    await modal.setDepot('Depot Principal');
    await modal.switchToDefaultFilterTab();
    await modal.setPeriod('allTime');
    await modal.submit();
    await GU.expectRowCount(gridId, GROUPING_ROW + LOT_FOR_ALLTIME);
  });

  it('find only lots setted during the adjustment process', async () => {
    const quinine = {
      label : 'Quinine Bichlorhydrate, sirop, 100mg base/5ml, 100ml, flacon, Unité',
      lot : 'QUININE-B',
      quantity : '17',
    };
    const vitamine = {
      label : 'Vitamines B1+B6+B12, 100+50+0.5mg/2ml, Amp, Unité',
      lot : 'VITAMINE-B',
      quantity : '23',
    };
    await modal.setDepot('Depot Principal');
    await modal.submit();
    const dump = JSON.stringify(GU.getCell(gridId, 1, 2)) + '|2 ' +
      JSON.stringify(GU.getCell(gridId, 2, 2)) + '|3 ' +
      JSON.stringify(GU.getCell(gridId, 3, 2)) + '|4 ' +
      JSON.stringify(GU.getCell(gridId, 4, 2)) + '|5 ' +
      JSON.stringify(GU.getCell(gridId, 5, 2)) + '|6 ' +
      JSON.stringify(GU.getCell(gridId, 6, 2)) + '|7 ' +
      JSON.stringify(GU.getCell(gridId, 7, 2)) + '|8 ' +
      JSON.stringify(GU.getCell(gridId, 8, 2)) + '|9 ' +
      JSON.stringify(GU.getCell(gridId, 9, 2)) + '|10 ' +
      JSON.stringify(GU.getCell(gridId, 10, 2)) + '|11 ' +
      JSON.stringify(GU.getCell(gridId, 11, 2)) + '|12 ' +
      JSON.stringify(GU.getCell(gridId, 12, 2)) + '|13 ' +
      JSON.stringify(GU.getCell(gridId, 13, 2)) + '|14 ' +
      JSON.stringify(GU.getCell(gridId, 14, 2)) + '|15 ' +
      JSON.stringify(GU.getCell(gridId, 15, 2)) + '|16 ' +
      JSON.stringify(GU.getCell(gridId, 16, 2)) + '|17 ' +
      JSON.stringify(GU.getCell(gridId, 17, 2)) + '|18 ' +
      JSON.stringify(GU.getCell(gridId, 18, 2)) + '|19 ' +
      JSON.stringify(GU.getCell(gridId, 19, 2));

    await GU.expectCellValueMatch(gridId, 1, 2, dump);
    // await GU.expectCellValueMatch(gridId, 1, 2, vitamine.label);
    // await GU.expectCellValueMatch(gridId, 1, 4, vitamine.lot);
    // await GU.expectCellValueMatch(gridId, 1, 5, vitamine.quantity);
    // await GU.expectCellValueMatch(gridId, 2, 2, quinine.label);
    // await GU.expectCellValueMatch(gridId, 2, 4, quinine.lot);
    // await GU.expectCellValueMatch(gridId, 2, 5, quinine.quantity);
    await filters.resetFilters();
  });
}
