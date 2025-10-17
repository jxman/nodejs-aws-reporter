/**
 * Excel Generation Module
 *
 * Generates Excel workbooks with AWS infrastructure data.
 * Creates 4 sheets: Summary, Regions, Services, and Service Coverage.
 */

const ExcelJS = require('exceljs');
const { formatDateEST } = require('./utils');

/**
 * Generate Excel report from AWS infrastructure data
 * @param {Object} sourceData - AWS infrastructure data
 * @returns {Promise<Buffer>} Excel file buffer
 */
async function generateExcelReport(sourceData) {
  const workbook = new ExcelJS.Workbook();

  // Set workbook properties
  workbook.creator = 'AWS Service Report Generator';
  workbook.created = new Date();
  workbook.modified = new Date();

  // Create all sheets
  await createSummarySheet(workbook, sourceData);
  await createRegionsSheet(workbook, sourceData);
  await createServicesSheet(workbook, sourceData);
  await createServiceCoverageSheet(workbook, sourceData);

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

/**
 * Create Summary sheet with metadata and high-level statistics
 */
async function createSummarySheet(workbook, sourceData) {
  const sheet = workbook.addWorksheet('Summary');

  // Header styling
  const headerStyle = {
    font: { bold: true, size: 12, color: { argb: 'FFFFFFFF' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } }
  };

  const dataStyle = {
    alignment: { vertical: 'middle' }
  };

  // Add title
  sheet.mergeCells('A1:B1');
  sheet.getCell('A1').value = 'AWS Service Report - Summary';
  sheet.getCell('A1').font = { bold: true, size: 14 };
  sheet.getCell('A1').alignment = { horizontal: 'center' };

  // Add data rows
  const rows = [
    ['', ''], // Empty row
    ['Field', 'Value'],
    ['Report Generated', formatDateEST(new Date())],
    ['Data Source', `s3://${process.env.SOURCE_BUCKET}/${process.env.SOURCE_KEY}`],
    ['Schema Version', sourceData.metadata?.schemaVersion || sourceData.metadata?.version || 'Unknown'],
    ['Data Timestamp', formatDateEST(sourceData.metadata?.timestamp || new Date())],
    ['', ''], // Empty row
    ['Total AWS Regions', sourceData.regions?.length || 0],
    ['Total AWS Services', sourceData.services?.length || 0],
    ['Service-by-Region Mappings', sourceData.servicesByRegion
      ? Object.keys(sourceData.servicesByRegion).reduce((acc, region) =>
        acc + (sourceData.servicesByRegion[region]?.length || 0), 0)
      : 'N/A']
  ];

  rows.forEach((row, index) => {
    sheet.addRow(row);
    if (index === 1) { // Header row
      sheet.getRow(index + 2).eachCell((cell) => {
        cell.style = headerStyle;
      });
    }
  });

  // Set column widths
  sheet.getColumn(1).width = 30;
  sheet.getColumn(2).width = 60;

  // Apply styling to data rows
  for (let i = 4; i <= sheet.rowCount; i++) {
    sheet.getRow(i).eachCell((cell) => {
      cell.style = dataStyle;
    });
  }
}

/**
 * Create Regions sheet with all AWS region details
 */
async function createRegionsSheet(workbook, sourceData) {
  const sheet = workbook.addWorksheet('Regions');

  // Define columns
  sheet.columns = [
    { header: 'Region Code', key: 'regionCode', width: 20 },
    { header: 'Region Name', key: 'regionName', width: 35 },
    { header: 'Availability Zones', key: 'azCount', width: 20 },
    { header: 'Service Count', key: 'serviceCount', width: 15 },
    { header: 'Launch Date', key: 'launchDate', width: 20 },
    { header: 'Blog URL', key: 'blogUrl', width: 50 }
  ];

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF70AD47' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 20;

  // Get service counts by region
  const servicesByRegion = sourceData.servicesByRegion || {};

  // Add data rows
  const regions = sourceData.regions || [];
  regions.forEach((region) => {
    const regionCode = region.code || region.regionCode || region.RegionCode || '';
    const launchDate = region.launchDate || region.LaunchDate || '';
    const blogUrl = region.blogUrl || region.BlogUrl || '';

    // Get service count for this region
    const servicesInRegion = servicesByRegion[regionCode] || [];
    const serviceCount = servicesInRegion.length;

    // Format launch date consistently
    let formattedLaunchDate = 'N/A';
    if (launchDate) {
      try {
        const date = new Date(launchDate);
        if (!isNaN(date.getTime())) {
          // Format as YYYY-MM-DD
          formattedLaunchDate = date.toISOString().split('T')[0];
        }
      } catch (e) {
        formattedLaunchDate = launchDate; // Use original if parsing fails
      }
    }

    const row = sheet.addRow({
      regionCode,
      regionName: region.name || region.regionName || region.RegionName || '',
      azCount: region.availabilityZones || region.AvailabilityZones?.length || 0,
      serviceCount,
      launchDate: formattedLaunchDate,
      blogUrl: blogUrl || 'N/A'
    });

    // Center align numeric columns
    row.getCell('azCount').alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell('serviceCount').alignment = { horizontal: 'center', vertical: 'middle' };

    // Add hyperlink for blog URL if present (not N/A)
    const blogCell = row.getCell('blogUrl');
    if (blogCell.value && blogCell.value !== 'N/A') {
      blogCell.value = {
        text: blogCell.value,
        hyperlink: blogCell.value
      };
      blogCell.font = { color: { argb: 'FF0563C1' }, underline: true };
    } else if (blogCell.value === 'N/A') {
      blogCell.font = { color: { argb: 'FF7F7F7F' }, italic: true }; // Gray italic for N/A
    }

    // Style N/A for launch date
    const launchDateCell = row.getCell('launchDate');
    if (launchDateCell.value === 'N/A') {
      launchDateCell.font = { color: { argb: 'FF7F7F7F' }, italic: true }; // Gray italic for N/A
    }
  });

  // Freeze header row
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  // Enable auto-filter
  sheet.autoFilter = {
    from: 'A1',
    to: 'F1'
  };
}

/**
 * Create Services sheet with all AWS services
 */
async function createServicesSheet(workbook, sourceData) {
  const sheet = workbook.addWorksheet('Services');

  // Define columns
  sheet.columns = [
    { header: 'Service Code', key: 'serviceCode', width: 30 },
    { header: 'Service Name', key: 'serviceName', width: 60 },
    { header: 'Available Regions', key: 'availableRegions', width: 18 },
    { header: 'Coverage %', key: 'coveragePercent', width: 12 }
  ];

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC000' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 20;

  // Get total regions count
  const regions = sourceData.regions || [];
  const totalRegions = regions.length;

  // Calculate region availability for each service
  const servicesByRegion = sourceData.servicesByRegion || {};
  const serviceRegionCounts = new Map();

  // Count how many regions each service is available in
  Object.keys(servicesByRegion).forEach(regionCode => {
    const servicesInRegion = servicesByRegion[regionCode] || [];
    servicesInRegion.forEach(serviceCode => {
      serviceRegionCounts.set(serviceCode, (serviceRegionCounts.get(serviceCode) || 0) + 1);
    });
  });

  // Add data rows
  const services = sourceData.services || [];
  // Sort services alphabetically by service name
  const sortedServices = [...services].sort((a, b) => {
    const nameA = (a.serviceName || a.ServiceName || a.name || '').toLowerCase();
    const nameB = (b.serviceName || b.ServiceName || b.name || '').toLowerCase();
    return nameA.localeCompare(nameB);
  });

  sortedServices.forEach((service) => {
    const serviceCode = service.code || service.serviceCode || service.ServiceCode || '';
    const regionCount = serviceRegionCounts.get(serviceCode) || 0;
    const coveragePercent = totalRegions > 0 ? ((regionCount / totalRegions) * 100).toFixed(1) : 0;

    const row = sheet.addRow({
      serviceCode,
      serviceName: service.name || service.serviceName || service.ServiceName || '',
      availableRegions: regionCount,
      coveragePercent: `${coveragePercent}%`
    });

    // Center align the numeric columns
    row.getCell('availableRegions').alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell('coveragePercent').alignment = { horizontal: 'center', vertical: 'middle' };

    // Color code coverage percentage
    const percentValue = parseFloat(coveragePercent);
    if (percentValue === 100) {
      row.getCell('coveragePercent').font = { color: { argb: 'FF00B050' }, bold: true }; // Green for 100%
    } else if (percentValue >= 75) {
      row.getCell('coveragePercent').font = { color: { argb: 'FF92D050' } }; // Light green for 75-99%
    } else if (percentValue >= 50) {
      row.getCell('coveragePercent').font = { color: { argb: 'FFFFC000' } }; // Orange for 50-74%
    } else if (percentValue > 0) {
      row.getCell('coveragePercent').font = { color: { argb: 'FFC00000' } }; // Red for 1-49%
    } else {
      row.getCell('coveragePercent').font = { color: { argb: 'FF7F7F7F' }, italic: true }; // Gray for 0%
    }
  });

  // Freeze header row
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  // Enable auto-filter
  sheet.autoFilter = {
    from: 'A1',
    to: 'D1'
  };
}

/**
 * Create Service Coverage sheet showing service availability by region
 */
async function createServiceCoverageSheet(workbook, sourceData) {
  const sheet = workbook.addWorksheet('Service Coverage');

  // Check if servicesByRegion data exists
  if (!sourceData.servicesByRegion || Object.keys(sourceData.servicesByRegion).length === 0) {
    // No service-by-region data available
    sheet.mergeCells('A1:E5');
    const cell = sheet.getCell('A1');
    cell.value = 'Service-by-region mapping not available in source data';
    cell.font = { size: 14, italic: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    return;
  }

  // Get unique services and regions
  const regions = sourceData.regions || [];
  const services = sourceData.services || [];

  // Create service code to name mapping
  const serviceMap = new Map();
  services.forEach(service => {
    const code = service.code || service.serviceCode || service.ServiceCode || '';
    const name = service.name || service.serviceName || service.ServiceName || '';
    serviceMap.set(code, name);
  });

  // Create headers: Service Name + Region Codes
  const headers = ['Service'];
  const regionCodes = regions.map(r => r.code || r.regionCode || r.RegionCode || '');
  headers.push(...regionCodes);

  // Add header row
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5B9BD5' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  headerRow.height = 30;

  // Set service column width
  sheet.getColumn(1).width = 40;

  // Set region column widths
  for (let i = 2; i <= headers.length; i++) {
    sheet.getColumn(i).width = 12;
  }

  // Add data rows
  const servicesByRegion = sourceData.servicesByRegion;

  // Sort services by name
  const sortedServices = [...services].sort((a, b) => {
    const nameA = (a.name || a.serviceName || a.ServiceName || '').toLowerCase();
    const nameB = (b.name || b.serviceName || b.ServiceName || '').toLowerCase();
    return nameA.localeCompare(nameB);
  });

  sortedServices.forEach((service) => {
    const serviceCode = service.code || service.serviceCode || service.ServiceCode || '';
    const serviceName = service.name || service.serviceName || service.ServiceName || '';

    const rowData = [serviceName];

    // Check each region for this service
    regionCodes.forEach((regionCode) => {
      const servicesInRegion = servicesByRegion[regionCode] || [];
      const isAvailable = servicesInRegion.includes(serviceCode);
      rowData.push(isAvailable ? '✓' : '✗');
    });

    const row = sheet.addRow(rowData);

    // Center align all cells except service name
    for (let i = 2; i <= rowData.length; i++) {
      const cell = row.getCell(i);
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      // Add conditional formatting for availability markers
      if (cell.value === '✓') {
        cell.font = { color: { argb: 'FF00B050' }, bold: true }; // Green checkmark
      } else if (cell.value === '✗') {
        cell.font = { color: { argb: 'FFC00000' }, bold: true }; // Red X
      }
    }
  });

  // Freeze first column and header row
  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];

  // Enable auto-filter
  sheet.autoFilter = {
    from: 'A1',
    to: `${String.fromCharCode(65 + headers.length - 1)}1`
  };
}

module.exports = {
  generateExcelReport
};
