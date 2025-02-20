// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1Ijoic2FyYWhoZTA1IiwiYSI6ImNtN2NxdDR2djA3OTIycnB0OXNyenRmaW8ifQ.MIoVxDMYrSy-nm4YY2K-3A';

// Initialize the map
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [-71.09415, 42.36027], // Boston coordinates
    zoom: 12,
    minZoom: 5,
    maxZoom: 18
});

let stations = [];
let trips = [];
let timeFilter = -1;
let svg;

// Function to calculate minutes since midnight
function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}

map.on('load', () => {
    // Boston bike lanes
    map.addSource('boston_route', {
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson?'
    });

    map.addLayer({
        id: 'bike-lanes-boston',
        type: 'line',
        source: 'boston_route',
        paint: { 'line-color': '#32D400', 'line-width': 5, 'line-opacity': 0.6 }
    });

    // Cambridge bike lanes
    map.addSource('cambridge_route', {
        type: 'geojson',
        data: 'https://data.cambridgema.gov/resource/xyz.geojson' // Replace with actual data URL
    });

    map.addLayer({
        id: 'bike-lanes-cambridge',
        type: 'line',
        source: 'cambridge_route',
        paint: { 'line-color': '#32D400', 'line-width': 5, 'line-opacity': 0.6 }
    });

    // Initialize the SVG element
    svg = d3.select('#map').select('svg');

    // Load both station and traffic data
    const stationUrl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    const trafficUrl = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

    Promise.all([d3.json(stationUrl), d3.csv(trafficUrl)]).then(([stationData, tripData]) => {
        stations = stationData.data.stations;
        trips = tripData;

        // Convert start and end times to Date objects
        trips.forEach(trip => {
            trip.started_at = new Date(trip.start_time);
            trip.ended_at = new Date(trip.end_time);
        });

        // Initial filter with all data
        filterTripsByTime();
    }).catch(error => {
        console.error('Error loading JSON or CSV:', error);
    });
});

// Convert coordinates to pixel values
function getCoords(station) {
    const point = new mapboxgl.LngLat(+station.lon, +station.lat);
    return map.project(point);
}

// Function to update circle positions
function updatePositions() {
    svg.selectAll('circle')
        .attr('cx', d => getCoords(d).x)
        .attr('cy', d => getCoords(d).y);
}

// Add event listeners for map interactions
map.on('move', updatePositions);
map.on('zoom', updatePositions);
map.on('resize', updatePositions);

// Filter trips based on selected time
function filterTripsByTime() {
    const filteredTrips = timeFilter === -1
        ? trips
        : trips.filter((trip) => {
            const startedMinutes = minutesSinceMidnight(trip.started_at);
            const endedMinutes = minutesSinceMidnight(trip.ended_at);
            return (
                Math.abs(startedMinutes - timeFilter) <= 60 ||
                Math.abs(endedMinutes - timeFilter) <= 60
            );
        });

    // Calculate filtered statistics
    const filteredDepartures = d3.rollup(
        filteredTrips,
        v => v.length,
        d => d.start_station_id
    );

    const filteredArrivals = d3.rollup(
        filteredTrips,
        v => v.length,
        d => d.end_station_id
    );

    // Create new filtered stations array
    const filteredStations = stations.map(station => {
        const newStation = { ...station };
        const id = station.short_name;
        newStation.arrivals = filteredArrivals.get(id) || 0;
        newStation.departures = filteredDepartures.get(id) || 0;
        newStation.totalTraffic = newStation.arrivals + newStation.departures;
        return newStation;
    });

    updateVisualization(filteredStations);
}

// Update the visualization with filtered data
function updateVisualization(filteredStations) {
    // Check if filteredStations is not empty before proceeding
    if (filteredStations.length === 0) {
        console.warn('No filtered stations to visualize.');
        return; // Exit if there's no data to visualize
    }

    console.log('Max traffic:', d3.max(filteredStations, d => d.totalTraffic));
    console.log('Time filter:', timeFilter);

    // Dynamically adjust the radius scale based on filtered data
    const maxTraffic = d3.max(filteredStations, d => d.totalTraffic);
    if (maxTraffic === undefined || maxTraffic === 0) {
        console.warn('Max traffic is 0 or undefined. Check data integrity.');
    }

    // Recalculate the radius scale based on filtered data
    const radiusScale = d3.scaleSqrt()
        .domain([0, maxTraffic || 1])  // Ensure non-zero domain
        .range([3, 50]);  // Adjust the range based on time filter

    // Select and bind data to circles
    const circles = svg.selectAll('circle')
        .data(filteredStations, d => d.short_name);  // Use short_name as the key

    // Handle entering new circles
    const enterCircles = circles.enter()
        .append('circle')
        .attr('fill', 'steelblue')
        .attr('stroke', 'white')
        .attr('stroke-width', 1)
        .attr('opacity', 0.6);

    // Merge and update circles, transition radius based on totalTraffic
    circles.merge(enterCircles)
        .transition()  // Apply transition to both entering and existing circles
        .duration(200)  // Transition duration in milliseconds
        .attr('r', d => {
            const radius = radiusScale(d.totalTraffic);
            console.log('Station:', d.name, 'Traffic:', d.totalTraffic, 'Radius:', radius);
            return radius;
        });

    // Remove old circles
    circles.exit().remove();

    // Ensure positions are updated after radius change
    updatePositions();
}

// Time slider event handling
const timeSlider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');

// Helper function to format time
function formatTime(minutes) {
    const date = new Date(0, 0, 0, Math.floor(minutes / 60), minutes % 60);
    return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// Update time display and filter data when slider moves
timeSlider.addEventListener('input', () => {
    timeFilter = Number(timeSlider.value);
    
    if (timeFilter === -1) {
        selectedTime.textContent = '';
        anyTimeLabel.style.display = 'block';
    } else {
        selectedTime.textContent = formatTime(timeFilter);
        anyTimeLabel.style.display = 'none';
    }
    
    filterTripsByTime();
});
