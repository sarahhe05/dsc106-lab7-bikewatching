// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1Ijoic2FyYWhoZTA1IiwiYSI6ImNtN2NxdDR2djA3OTIycnB0OXNyenRmaW8ifQ.MIoVxDMYrSy-nm4YY2K-3A';

// Initialize the map
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [-71.0892, 42.3398],
    zoom: 12
});

let stations = [];
let trips = [];
let timeFilter = -1;
let svg;
let circles;

// Add this with other global variables
const stationFlow = d3.scaleQuantize()
    .domain([0, 1])
    .range([0, 0.5, 1]);

// Function to calculate minutes since midnight
function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}

map.on('load', async () => {
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

    // Create SVG overlay after map initialization
    svg = d3.select(map.getCanvasContainer())
        .append('svg')
        .style('position', 'absolute')
        .style('top', 0)
        .style('left', 0)
        .style('width', '100%')
        .style('height', '100%')
        .style('pointer-events', 'none');

    // Load both station and traffic data
    const stationUrl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    const trafficUrl = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

    try {
        // Load stations
        const stationResponse = await fetch('https://dsc106.com/labs/lab07/data/bluebikes-stations.json');
        const stationData = await stationResponse.json();
        stations = stationData.data.stations;

        // Load and parse trips
        trips = await d3.csv(
            'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
            (trip) => ({
                ...trip,
                started_at: new Date(trip.started_at),
                ended_at: new Date(trip.ended_at)
            })
        );

        // Initialize circles with key function
        circles = svg.selectAll('circle')
            .data(stations, d => d.short_name)
            .join('circle')
            .attr('fill-opacity', 0.6)
            .attr('stroke', 'white')
            .attr('stroke-width', 1)
            .attr('pointer-events', 'auto')
            .style('--departure-ratio', d => 
                stationFlow(d.totalTraffic ? d.departures / d.totalTraffic : 0)
            );

        // Set up event listeners
        const timeSlider = document.getElementById('time-slider');
        timeSlider.addEventListener('input', updateTimeDisplay);

        // Initial update
        updateTimeDisplay();

    } catch (error) {
        console.error('Error loading data:', error);
    }
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

    updateScatterPlot(filteredStations);
}

// Update the visualization with filtered data
function updateScatterPlot(filteredStations) {
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

    // Create a color scale
    const colorScale = d3.scaleQuantize()
        .domain([0, 1])
        .range(['darkorange', 'purple', 'steelblue']);

    // Select and bind data to circles
    const circles = svg.selectAll('circle')
        .data(filteredStations, d => d.short_name);  // Use short_name as the key

    // Handle entering new circles
    const enterCircles = circles.enter()
        .append('circle')
        .attr('fill-opacity', 0.6)
        .attr('stroke', 'white')
        .attr('stroke-width', 1)
        .attr('pointer-events', 'auto');

    // Merge and update circles, transition radius based on totalTraffic
    circles.merge(enterCircles)
        .transition()  // Apply transition to both entering and existing circles
        .duration(200)  // Transition duration in milliseconds
        .attr('r', d => {
            const radius = radiusScale(d.totalTraffic);
            console.log('Station:', d.name, 'Traffic:', d.totalTraffic, 'Radius:', radius);
            return radius;
        })
        .attr('fill', d => {
            const ratio = d.totalTraffic ? d.departures / d.totalTraffic : 0;
            return colorScale(ratio);
        });

    // Remove old circles
    circles.exit().remove();

    // Ensure positions are updated after radius change
    updatePositions();

    // Update tooltips
    circles.selectAll('title').remove();
    circles.append('title')
        .text(d => {
            const flowRatio = d.totalTraffic ? d.departures / d.totalTraffic : 0;
            return `${d.name}\n${d.totalTraffic} trips ` +
                   `(${d.departures} departures, ${d.arrivals} arrivals)\n` +
                   `Flow ratio: ${(flowRatio * 100).toFixed(1)}% departures`;
        });
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
function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value);
    
    if (timeFilter === -1) {
        selectedTime.textContent = '';
        anyTimeLabel.style.display = 'block';
    } else {
        selectedTime.textContent = formatTime(timeFilter);
        anyTimeLabel.style.display = 'none';
    }
    
    filterTripsByTime();
}

function updateFilteredData() {
    let filteredDepartures, filteredArrivals;
    if (timeFilter === -1) {
        filteredDepartures = trips;
        filteredArrivals = trips;
    } else {
        filteredDepartures = filterByMinute(departuresByMinute, timeFilter);
        filteredArrivals = filterByMinute(arrivalsByMinute, timeFilter);
    }

    // Calculate station traffic
    const departuresMap = d3.rollup(
        filteredDepartures,
        v => v.length,
        d => d.start_station_id
    );
    const arrivalsMap = d3.rollup(
        filteredArrivals,
        v => v.length,
        d => d.end_station_id
    );

    // Update station data with traffic
    const filteredStations = stations.map(station => ({
        ...station,
        departures: departuresMap.get(station.short_name) || 0,
        arrivals: arrivalsMap.get(station.short_name) || 0,
        totalTraffic: (departuresMap.get(station.short_name) || 0) + 
                     (arrivalsMap.get(station.short_name) || 0)
    }));

    // Update circle sizes with different scales for filtered vs unfiltered
    const maxTraffic = d3.max(filteredStations, d => d.totalTraffic) || 1;
    console.log('Max traffic:', maxTraffic);
    console.log('Time filter:', timeFilter);

    const radiusScale = d3.scaleSqrt()
        .domain([0, maxTraffic])
        .range(timeFilter === -1 ? [0, 25] : [3, 50]);  // Different ranges based on filter

    // Update circles with transition
    circles.data(filteredStations)
        .join(
            enter => enter.append('circle')
                .attr('fill-opacity', 0.6)
                .attr('stroke', 'white')
                .attr('stroke-width', 1)
                .attr('pointer-events', 'auto'),
            update => update,
            exit => exit.remove()
        )
        .transition()
        .duration(500)
        .attr('r', d => radiusScale(d.totalTraffic))
        .attr('cx', d => getCoords(d).x)
        .attr('cy', d => getCoords(d).y)
        .style('--departure-ratio', d => 
            stationFlow(d.totalTraffic ? d.departures / d.totalTraffic : 0)
        );

    // Update tooltips
    circles.selectAll('title').remove();
    circles.append('title')
        .text(d => {
            const flowRatio = d.totalTraffic ? d.departures / d.totalTraffic : 0;
            return `${d.name}\n${d.totalTraffic} trips ` +
                   `(${d.departures} departures, ${d.arrivals} arrivals)\n` +
                   `Flow ratio: ${(flowRatio * 100).toFixed(1)}% departures`;
        });
}
