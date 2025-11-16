  // Quantize scale for traffic flow
  const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);
// Helper to format time from minutes
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// Helper to get minutes since midnight
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Efficient filtering using buckets
function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat();
  }
  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;
  if (minMinute > maxMinute) {
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}

// Compute station traffic for filtered trips
function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(window.departuresByMinute, timeFilter),
    (v) => v.length,
    (d) => d.start_station_id
  );
  const arrivals = d3.rollup(
    filterByMinute(window.arrivalsByMinute, timeFilter),
    (v) => v.length,
    (d) => d.end_station_id
  );
  return stations.map((station) => {
    let id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
console.log('Mapbox GL JS Loaded:', mapboxgl);

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoiYW55dWFuIiwiYSI6ImNtaTBzd3o5ZTEya2Uycm9xMDZtNTdzZjcifQ.2KddgkMMu4gC-gn_ioRr7w';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});

// Helper function to convert station coordinates to pixel coordinates
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat); // Convert lon/lat to Mapbox LngLat
  const { x, y } = map.project(point); // Project to pixel coordinates
  return { cx: x, cy: y }; // Return as object for use in SVG attributes
}

// Wait for the map to load before adding data
map.on('load', async () => {
  // Add Boston bike lanes data source
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  // Visualize Boston bike lanes as green lines
  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': '#32D400',  // Bright green using hex code
      'line-width': 5,          // Thickness of lines
      'line-opacity': 0.6,      // 60% opacity
    },
  });

  // Fetch and parse Bluebikes station data
  let jsonData;
  try {
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';

    // Await JSON fetch
    jsonData = await d3.json(jsonurl);

    console.log('Loaded JSON Data:', jsonData); // Log to verify structure

    // Access the stations array
    let stations = jsonData.data.stations;
    console.log('Stations Array:', stations);


    // Efficient trip bucketing
    window.departuresByMinute = Array.from({ length: 1440 }, () => []);
    window.arrivalsByMinute = Array.from({ length: 1440 }, () => []);

    // Parse trips and bucket by minute
    let trips = await d3.csv(
      'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
      (trip) => {
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);
        let startedMinutes = minutesSinceMidnight(trip.started_at);
        let endedMinutes = minutesSinceMidnight(trip.ended_at);
        window.departuresByMinute[startedMinutes].push(trip);
        window.arrivalsByMinute[endedMinutes].push(trip);
        return trip;
      }
    );
    console.log('Loaded trips data:', trips);

    // Initial station traffic
    stations = computeStationTraffic(stations);
    console.log('Stations with traffic data:', stations);

    // Create a square root scale for radius
    const radiusScale = d3
      .scaleSqrt()
      .domain([0, d3.max(stations, (d) => d.totalTraffic)])
      .range([0, 25]);

    // Select the SVG element inside the map container
    const svg = d3.select('#map').select('svg');

    // Append circles to the SVG for each station (with key)
    let circles = svg
      .selectAll('circle')
      .data(stations, (d) => d.short_name)
      .enter()
      .append('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .attr('stroke', 'white')
      .attr('stroke-width', 1)
      .attr('fill-opacity', 0.6)
      .style('--departure-ratio', (d) => stationFlow(d.totalTraffic ? d.departures / d.totalTraffic : 0))
      .each(function (d) {
        d3.select(this)
          .append('title')
          .text(
            `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
          );
      });

    // Function to update circle positions when the map moves/zooms
    function updatePositions() {
      svg.selectAll('circle')
        .attr('cx', (d) => getCoords(d).cx)
        .attr('cy', (d) => getCoords(d).cy);
    }

    // Initial position update when map loads
    updatePositions();

    // Reposition markers on map interactions
    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('resize', updatePositions);
    map.on('moveend', updatePositions);

    // Time slider logic
    const timeSlider = document.getElementById('time-slider');
    const selectedTime = document.getElementById('selected-time');
    const anyTimeLabel = document.getElementById('any-time');

    function updateScatterPlot(timeFilter) {
      // Recompute station traffic for filtered trips
      const filteredStations = computeStationTraffic(stations, timeFilter);
      // Adjust radius scale range for filtering
      timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);
      // Update circles with key and color
      circles = svg
        .selectAll('circle')
        .data(filteredStations, (d) => d.short_name)
        .join('circle')
        .attr('r', (d) => radiusScale(d.totalTraffic))
        .attr('stroke', 'white')
        .attr('stroke-width', 1)
        .attr('fill-opacity', 0.6)
        .style('--departure-ratio', (d) => stationFlow(d.totalTraffic ? d.departures / d.totalTraffic : 0))
        .each(function (d) {
          d3.select(this)
            .selectAll('title').remove();
          d3.select(this)
            .append('title')
            .text(
              `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
            );
        });
      updatePositions();
    }

    function updateTimeDisplay() {
      let timeFilter = Number(timeSlider.value);
      if (timeFilter === -1) {
        selectedTime.textContent = '';
        anyTimeLabel.style.display = 'block';
      } else {
        selectedTime.textContent = formatTime(timeFilter);
        anyTimeLabel.style.display = 'none';
      }
      updateScatterPlot(timeFilter);
    }

    function updateScatterPlot(timeFilter) {
  // previus code ommitted for brevity
    circles
    // previus code ommitted for brevity
    .style('--departure-ratio', (d) =>
      stationFlow(d.departures / d.totalTraffic),
    );
}

    timeSlider.addEventListener('input', updateTimeDisplay);
    updateTimeDisplay();

  } catch (error) {
    console.error('Error loading JSON:', error); // Handle errors
  }
});