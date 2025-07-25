/**
 * @overview
 * Journal Reports
 *
 * @description
 * This module contains all the code for rendering PDFs of Journal.
 */

const _ = require('lodash');
const multipayIndice = require('./index');
const ReportManager = require('../../../lib/ReportManager');

const REPORT_TEMPLATE = './server/controllers/payroll/multiplePayrollIndice/report.handlebars';

exports.document = multipayIndiceExport;

/**
 * GET reports/finance/multiplepayrollIndice
 *
 * @method multipayIndiceExport
 */
async function multipayIndiceExport(req, res) {

  const options = {
    ...req.query,
    filename                 : 'TREE.MULTI_PAYROLL_INDICE',
    orientation              : 'landscape',
    csvKey                   : 'rows',
    suppressDefaultFiltering : true,
    suppressDefaultFormating : false,
  };

  const report = new ReportManager(REPORT_TEMPLATE, req.session, options);
  const { employees, rubrics } = await multipayIndice.lookUp(options);
  const rows = getEmployeeRubricMatrix(employees, rubrics);
  const result = await report.render({ rows });
  res.set(result.headers).send(result.report);
}

/**
 * @function getEmployeeRubricMatrix
 *
 * @description
 * This function takes a list of employees and their assigned rubrics and returns
 * a matrix of the employees by rubrics for display in a grid.
 */
function getEmployeeRubricMatrix(employees, rubrics) {
  const headers = { display_name : '', service : '' };

  rubrics.forEach(r => { headers[r.abbr] = ''; });

  // return a matrix of employees by rubrics
  return employees.map(employee => {
    const row = {
      display_name : employee.display_name,
      service : employee.service_name,
    };

    // map each rubric into columns
    employee.rubrics.forEach(r => {
      row[r.rubric_abbr] = r.rubric_value;
    });

    return row;
  });
}

async function template(req, res) {
  const options = {
    ...req.query,
    filename                 : req.query.filename,
    orientation              : 'landscape',
    optionsRenderer          : 'csv',
    renderer                 : 'csv',
    csvKey                   : 'rows',
    suppressDefaultFiltering : true,
    suppressDefaultFormating : false,
  };

  const report = new ReportManager(REPORT_TEMPLATE, req.session, options);
  const { employees, rubrics } = await multipayIndice.lookUp(options);
  const rows = getEmployeeRubricMatrixUpload(employees, rubrics);

  const result = await report.render({ rows });
  res.set(result.headers).send(result.report);
}

/**
 * @function getEmployeeRubricMatrixUpload
 *
 * @description
 * This function takes a list of employees and their assigned rubrics and returns
 * a matrix of the employees by configurables rubrics for upload data.
 */
function getEmployeeRubricMatrixUpload(employees, rubrics) {
  // Filtering of configurable rubrics
  const rubricsFiltered = rubrics.filter(item => (item.indice_to_grap));

  employees.forEach(emp => {
    const tabRubrics = [];

    rubricsFiltered.forEach(filt => {
      const defaultValue = {
        employee_uuid : emp.uuid,
        rubric_id     : filt.id,
        rubric_value  : 0,
        rubric_abbr   : filt.abbr,
      };

      if (emp.rubrics.length) {
        emp.rubrics.forEach(rb => {
          if (rb.rubric_id === filt.id) {
            defaultValue.rubric_value = rb.rubric_value;
          }
        });
      }

      tabRubrics.push(defaultValue);
    });

    delete emp.rubrics;
    emp.rubrics = tabRubrics;
  });

  const headers = { employee_reference : '', display_name : '', service : '' };

  rubricsFiltered.forEach(r => { headers[r.abbr] = ''; });

  // return a matrix of employees by rubrics filtered
  return employees.map(employee => {
    const row = {
      employee_reference : employee.employee_reference,
      display_name : employee.display_name,
      service : employee.service_name,
    };

    // map each rubric into columns
    employee.rubrics.forEach(r => {
      row[r.rubric_abbr] = r.rubric_value;
    });

    return row;
  });
}

module.exports.template = template;
