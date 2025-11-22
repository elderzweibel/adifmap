// --- Global Variables and Constants ---
const BAND_COLORS = {
    '160M': '#800000', '80M': '#FF0000', '60M': '#FF8000', '40M': '#FFAA00',
    '30M': '#FFFF00', '20M': '#00FF00', '17M': '#00FFFF', '15M': '#00AAFF',
    '12M': '#0000FF', '10M': '#8000FF', '6M': '#FF00FF', '2M': '#008080',
    '1.25M': '#808080', '70CM': '#808000', '33CM': '#008000', '23CM': '#000080',
    'SHF': '#804040', 'OTHER': '#404040', 'N/A': '#000000'
};
let allQSOs = []; // Raw QSOs from the file
let aggregatedQSOs = []; // Grouped/Cleaned QSOs used for mapping
let homeCoords = null;
let homeMarker = null;

// --- Map Initialization ---
const map = L.map('map').setView([0, 0], 2);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Use a cluster group instead of a standard layer for markers
let clusterGroup = L.markerClusterGroup(); 
map.addLayer(clusterGroup); 
let overlayLayer = L.layerGroup().addTo(map);

// --- Geodesic and Maidenhead Functions ---

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function calculateBearing(lat1, lon1, lat2, lon2) {
    lat1 = lat1 * Math.PI / 180;
    lon1 = lon1 * Math.PI / 180;
    lat2 = lat2 * Math.PI / 180;
    lon2 = lon2 * Math.PI / 180;

    const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
              Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
    let brng = Math.atan2(y, x);
    brng = brng * 180 / Math.PI;
    return (brng + 360) % 360;
}

function gridToLatLon(grid) {
    if (!grid || grid.length < 4) return null;
    const g = grid.toUpperCase().trim();
    let lon = (g.charCodeAt(0) - 'A'.charCodeAt(0)) * 20 - 180;
    let lat = (g.charCodeAt(1) - 'A'.charCodeAt(0)) * 10 - 90;
    if (g.length >= 4) { lon += parseInt(g[2]) * 2; lat += parseInt(g[3]) * 1; }
    if (g.length >= 6) { lon += (g.charCodeAt(4) - 'A'.charCodeAt(0)) * 5 / 60; lat += (g.charCodeAt(5) - 'A'.charCodeAt(0)) * 2.5 / 60; }
    if (g.length === 4) { lon += 1; lat += 0.5; } 
    else if (g.length >= 6) { lon += 2.5 / 60; lat += 1.25 / 60; }
    return { lat: lat, lon: lon, grid: g };
}

function getGridBounds(grid4) {
    const coords = gridToLatLon(grid4.substring(0, 4));
    if (!coords) return null;
    const sw_lat = coords.lat - 0.5;
    const sw_lon = coords.lon - 1;
    const ne_lat = sw_lat + 1;
    const ne_lon = sw_lon + 2;
    return [
        [sw_lat, sw_lon], [ne_lat, sw_lon], [ne_lat, ne_lon], [sw_lat, ne_lon], [sw_lat, sw_lon]
    ];
}

// --- Home Location Marker ---

window.updateHomeLocation = function() {
    if (homeMarker) homeMarker.remove();
    const homeGridInput = document.getElementById('homeGrid').value.trim();
    const coords = gridToLatLon(homeGridInput);

    if (coords) {
        homeCoords = coords;
        document.getElementById('homeLocationDisplay').textContent = `Set to ${homeCoords.grid} (${coords.lat.toFixed(2)}, ${coords.lon.toFixed(2)})`;
        const homeIcon = L.divIcon({ className: 'home-marker', iconSize: [12, 12], iconAnchor: [6, 6] });
        homeMarker = L.marker([homeCoords.lat, homeCoords.lon], { icon: homeIcon }).addTo(map);
        homeMarker.bindTooltip(`Home QTH: ${homeCoords.grid}`, { permanent: false, direction: 'top' });
    } else {
        homeCoords = null;
        document.getElementById('homeLocationDisplay').textContent = 'Invalid Grid';
    }
    window.applyFilters();
}


// --- ADIF Parsing ---
function parseAdif(adifText) {
    const qsos = [];
    const records = adifText.toUpperCase().split('<EOR>');
    const fieldRegex = /<([A-Z0-9_]+):(\d+)>([^<]+)/g;

    for (const record of records) {
        if (record.trim() === '' || record.includes('<EOH>')) continue;
        const qso = {};
        fieldRegex.lastIndex = 0; 
        let match;
        while ((match = fieldRegex.exec(record)) !== null) {
            const fieldName = match[1].trim();
            const fieldValue = match[3].trim();
            qso[fieldName] = fieldValue;
        }
        if (Object.keys(qso).length > 0) qsos.push(qso);
    }
    return qsos;
}

// --- QSO Aggregation Function ---

function processQSOs(rawQSOs) {
    const aggregated = {};
    
    rawQSOs.forEach(qso => {
        const call = qso.CALL || 'NOCALL';
        const band = qso.BAND || 'N/A';
        // Only use 4-digit grid for aggregation key
        const grid = (qso.GRIDSQUARE && qso.GRIDSQUARE.length >= 4) ? qso.GRIDSQUARE.substring(0, 4) : 'NOGRID';
        
        const key = `${call}_${band}_${grid}`; 
        
        if (!aggregated[key]) {
            aggregated[key] = {
                ...qso, 
                count: 1,
                firstQSO: qso,
                lastQSO: qso,
            };
        } else {
            aggregated[key].count++;
            // Update last QSO time if current QSO is chronologically later (simple check)
            if ((qso.QSO_DATE + qso.TIME_ON) > (aggregated[key].lastQSO.QSO_DATE + aggregated[key].lastQSO.TIME_ON)) {
                 aggregated[key].lastQSO = qso; 
            }
        }
    });

    return Object.values(aggregated);
}

// --- Filtering and Mapping ---

function buildFilterOptions(qsos) {
    const bands = new Set(['ALL']);
    const modes = new Set(['ALL']);
    
    for (const qso of qsos) {
        if (qso.BAND) bands.add(qso.BAND);
        if (qso.MODE) modes.add(qso.MODE);
    }

    ['bandFilter', 'modeFilter'].forEach(id => {
        const select = document.getElementById(id);
        const currentSelected = select.value;
        select.innerHTML = '';
        const dataSet = (id === 'bandFilter' ? bands : modes);
        
        Array.from(dataSet).sort().forEach(item => {
            const option = document.createElement('option');
            option.value = item;
            option.textContent = item;
            if (item === currentSelected) option.selected = true;
            select.appendChild(option);
        });
    });
}

window.applyFilters = function() {
    clusterGroup.clearLayers(); // Clear markers from the cluster group
    overlayLayer.clearLayers();
    let mappedCount = 0;
    let bounds = [];
    const mappedGrids = new Set();

    const selectedBand = document.getElementById('bandFilter').value;
    const selectedMode = document.getElementById('modeFilter').value;

    for (const qso of aggregatedQSOs) { // Use aggregated QSOs
        const qsoBand = qso.BAND || 'N/A';
        const qsoMode = qso.MODE || 'N/A';

        if (selectedBand !== 'ALL' && qsoBand !== selectedBand) continue;
        if (selectedMode !== 'ALL' && qsoMode !== selectedMode) continue;

        // Determine Coordinates
        let lat = null;
        let lon = null;
        let locationSource = 'N/A';
        const grid = qso.GRIDSQUARE || '';
        const coords = gridToLatLon(grid);

        if (coords) {
            lat = coords.lat;
            lon = coords.lon;
            locationSource = `Grid Center (${coords.grid})`;
        } else if (parseFloat(qso.LAT) && parseFloat(qso.LON)) {
            lat = parseFloat(qso.LAT);
            lon = parseFloat(qso.LON);
            locationSource = 'LAT/LON';
        }

        if (lat !== null && lon !== null) {
            mappedCount++;
            bounds.push([lat, lon]);

            const date = qso.lastQSO.QSO_DATE || 'N/A'; 
            const time = qso.lastQSO.TIME_ON || 'N/A';
            const callsign = qso.CALL || 'N/A';
            const qsoCountText = qso.count > 1 ? ` (${qso.count} contacts)` : '';

            let geoStats = '';
            if (homeCoords) {
                const dist = calculateDistance(homeCoords.lat, homeCoords.lon, lat, lon);
                const brng = calculateBearing(homeCoords.lat, homeCoords.lon, lat, lon);
                geoStats = `
                    <strong>Distance:</strong> ${dist.toFixed(0)} km<br>
                    <strong>Bearing:</strong> ${brng.toFixed(0)}° (Short Path)
                `;
                L.polyline([[homeCoords.lat, homeCoords.lon], [lat, lon]], {
                    color: 'rgba(255, 0, 0, 0.2)', weight: 1, dashArray: '5, 5'
                }).addTo(overlayLayer);
            }

            const bandKey = qsoBand.toUpperCase().replace(/\s/g, '');
            const markerColor = BAND_COLORS[bandKey] || BAND_COLORS['OTHER'];

            // Create custom icon
            const smallDotIcon = L.divIcon({
                className: 'qso-marker',
                html: `<div style="background-color: ${markerColor}; width: 100%; height: 100%; border-radius: 50%;"></div>`,
                iconSize: [8, 8],
                iconAnchor: [4, 4]
            });

            const marker = L.marker([lat, lon], { icon: smallDotIcon });
            marker.bindTooltip(`
                <strong>Call:</strong> ${callsign}${qsoCountText}<br>
                <strong>Last QSO:</strong> ${date} ${time}Z<br>
                <strong>Mode/Band:</strong> ${qsoMode} / ${qsoBand}<br>
                ${geoStats}
                <hr style="margin: 2px 0;">
                ${locationSource} | Lat/Lon: ${lat.toFixed(4)}, ${lon.toFixed(4)}
            `, {
                permanent: false, direction: 'top', offset: L.point(0, -5)
            });
            
            // ADD MARKER TO THE CLUSTER GROUP
            clusterGroup.addLayer(marker); 

            const grid4 = grid.substring(0, 4);
            if (grid4.length === 4) mappedGrids.add(grid4);
        }
    }
    
    // Draw 4-digit Maidenhead Grid Overlays
    mappedGrids.forEach(grid4 => {
        const boundsCoords = getGridBounds(grid4);
        if (boundsCoords) {
            L.polygon(boundsCoords, {
                color: '#6c757d', weight: 1, fillColor: '#6c757d', fillOpacity: 0.1, interactive: false
            }).addTo(overlayLayer);
        }
    });

    // Update statistics
    document.getElementById('mappedCount').textContent = mappedCount;

    // Fit the map view to show all markers
    if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [50, 50] });
    }
}

// --- Main File Loader ---
document.addEventListener('DOMContentLoaded', () => {
    window.updateHomeLocation();

    document.getElementById('adifFile').addEventListener('change', function(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            const adifText = e.target.result;
            try {
                allQSOs = parseAdif(adifText);
                aggregatedQSOs = processQSOs(allQSOs); 
                
                document.getElementById('qsoCount').textContent = allQSOs.length;
                
                buildFilterOptions(aggregatedQSOs);
                window.applyFilters(); 
            } catch (error) {
                alert('Error parsing ADIF file: ' + error.message);
                document.getElementById('qsoCount').innerHTML = '<span class="error">Error!</span>';
                document.getElementById('mappedCount').innerHTML = '<span class="error">Error!</span>';
                console.error("Parsing error:", error);
            }
        };
        reader.readAsText(file);
    });
});
