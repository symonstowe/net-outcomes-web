// Dynamic xG Shot Visualizer
// Load the shot data and create interactive visualization

// Global variables
let allShotsData = [];
let currentFilteredData = [];
let svg, rinkGroup, scaleX, scaleY;
let currentProbability = 0.05;
let showActualGoals = true;
let selectedTeam = '';
let availableTeams = [];
let teamStats = {}; // Store pre-calculated stats for all teams
let isLoading = false;

// Load team list first, then initialize
d3.json("/data/teams/team_list.json.gz").then(teamsWithStats => {
    console.log(`Found ${teamsWithStats.length} teams with stats`);

    // Populate teams and stats
    availableTeams = teamsWithStats.map(d => d.team).filter(team => team !== 'None');
    teamsWithStats.forEach(d => {
        teamStats[d.team] = d;
    });

    // Set default team to Ottawa
    selectedTeam = availableTeams.includes('OTT') ? 'OTT' : availableTeams[0];

    // Initialize controls with team list
    initializeControls();

    // Create the rink visualization
    createRink();

    // Load initial team data
    loadTeamData(selectedTeam);

}).catch(error => {
    console.error("Error loading team list:", error);
    document.getElementById('chart').innerHTML = `<div style="text-align: center; padding: 50px; color: red;">Error loading team list: ${error.message}</div>`;
});

function loadTeamData(teamCode) {
    if (isLoading) return; // Prevent multiple simultaneous loads

    isLoading = true;
    console.log(`Loading data for ${teamCode}...`);

    // Load team-specific data
    d3.json(`/data/teams/${teamCode.toLowerCase()}_shots.json.gz`).then(data => {
        console.log(`Loaded ${data.length.toLocaleString()} shots for ${teamCode}`);

        allShotsData = data;
        isLoading = false;

        // Update visualization
        updateVisualization();

    }).catch(error => {
        console.error(`Error loading ${teamCode} data:`, error);
        isLoading = false;
        document.getElementById('chart').innerHTML = `<div style="text-align: center; padding: 50px; color: red;">Error loading ${teamCode} data: ${error.message}</div>`;
    });
}

function initializeControls() {
    // Populate dropdown with available teams (sorted)
    const sortedTeams = availableTeams.sort();
    console.log(`Populating dropdown with ${sortedTeams.length} teams`);

    const teamSelect = d3.select("#team-select");

    sortedTeams.forEach(team => {
        teamSelect.append("option")
            .attr("value", team)
            .text(team)
            .property("selected", team === selectedTeam);
    });

    // Set up event listeners
    d3.select("#probability-slider").on("input", function () {
        currentProbability = +this.value;
        d3.select("#slider-value").text(currentProbability.toFixed(2));
        updateVisualization();
    });

    d3.select("#show-actual-goals").on("change", function () {
        showActualGoals = this.checked;
        updateVisualization();
    });

    d3.select("#team-select").on("change", function () {
        if (this.value !== selectedTeam) {
            selectedTeam = this.value;
            loadTeamData(selectedTeam);
        }
    });
}

function createRink() {
    // Rink dimensions
    const width = 1200;
    const height = 650; // Moderate height increase for arrow and text
    const margin = { top: 50, right: 50, bottom: 50, left: 50 };
    const rinkWidth = width - margin.left - margin.right;
    const rinkHeight = height - margin.top - margin.bottom - 50; // Reserve 50px for arrow and text

    // Scales
    scaleX = d3.scaleLinear()
        .domain([-100, 100])
        .range([0, rinkWidth]);

    scaleY = d3.scaleLinear()
        .domain([-42.5, 42.5])
        .range([rinkHeight, 0]);

    // Create SVG
    svg = d3.select("#chart")
        .append("svg")
        .attr("width", width)
        .attr("height", height)
        .style("background", "#f5f5f5")
        .style("display", "block")
        .style("margin", "0 auto");

    rinkGroup = svg.append("g")
        .attr("transform", `translate(${margin.left}, ${margin.top})`);

    // Draw rink elements
    drawRinkOutline();
    drawRinkLines();
    drawCreases();
    drawNets();
    drawFaceoffDots();
    drawDirectionArrow();
}

function drawRinkOutline() {
    const cornerRadius = scaleX(28) - scaleX(0);
    const rinkPath = `
        M ${scaleX(-100 + 28)} ${scaleY(42.5)}
        L ${scaleX(100 - 28)} ${scaleY(42.5)}
        A ${cornerRadius} ${cornerRadius} 0 0 1 ${scaleX(100)} ${scaleY(42.5 - 28)}
        L ${scaleX(100)} ${scaleY(-42.5 + 28)}
        A ${cornerRadius} ${cornerRadius} 0 0 1 ${scaleX(100 - 28)} ${scaleY(-42.5)}
        L ${scaleX(-100 + 28)} ${scaleY(-42.5)}
        A ${cornerRadius} ${cornerRadius} 0 0 1 ${scaleX(-100)} ${scaleY(-42.5 + 28)}
        L ${scaleX(-100)} ${scaleY(42.5 - 28)}
        A ${cornerRadius} ${cornerRadius} 0 0 1 ${scaleX(-100 + 28)} ${scaleY(42.5)}
        Z
    `;
    rinkGroup.append("path")
        .attr("d", rinkPath)
        .attr("fill", "white")
        .attr("stroke", "black")
        .attr("stroke-width", 3);
}

function drawRinkLines() {
    // Center line
    rinkGroup.append("line")
        .attr("x1", scaleX(0))
        .attr("x2", scaleX(0))
        .attr("y1", scaleY(-42.5))
        .attr("y2", scaleY(42.5))
        .attr("stroke", "red")
        .attr("stroke-width", 5)
        .attr("stroke-opacity", 0.7);

    // Blue lines
    [-25, 25].forEach(x => {
        rinkGroup.append("line")
            .attr("x1", scaleX(x))
            .attr("x2", scaleX(x))
            .attr("y1", scaleY(-42.5))
            .attr("y2", scaleY(42.5))
            .attr("stroke", "blue")
            .attr("stroke-width", 5)
            .attr("stroke-opacity", 0.7);
    });

    // Goal lines
    [-89, 89].forEach(x => {
        rinkGroup.append("line")
            .attr("x1", scaleX(x))
            .attr("x2", scaleX(x))
            .attr("y1", scaleY(-37))
            .attr("y2", scaleY(37))
            .attr("stroke", "red")
            .attr("stroke-width", 2)
            .attr("stroke-opacity", 0.7);
    });

    // Center circle
    rinkGroup.append("circle")
        .attr("cx", scaleX(0))
        .attr("cy", scaleY(0))
        .attr("r", scaleX(15) - scaleX(0))
        .attr("stroke", "red")
        .attr("stroke-width", 3)
        .attr("stroke-opacity", 0.7)
        .attr("fill", "none");
}

function drawCreases() {
    const crease = {
        halfWidth: 4,
        depth: 4,
        radius: 6
    };

    [-89, 89].forEach(goalX => {
        const dir = goalX < 0 ? 1 : -1;
        const x0 = goalX;
        const x1 = goalX + dir * crease.depth;
        const y0 = -crease.halfWidth;
        const y1 = crease.halfWidth;
        const rx = Math.abs(scaleX(crease.radius) - scaleX(0));

        const d = [
            `M ${scaleX(x0)} ${scaleY(y0)}`,
            `L ${scaleX(x0)} ${scaleY(y1)}`,
            `L ${scaleX(x1)} ${scaleY(y1)}`,
            `A ${rx} ${rx} 0 0 ${goalX > 0 ? 0 : 1} ${scaleX(x1)} ${scaleY(y0)}`,
            `L ${scaleX(x0)} ${scaleY(y0)}`,
            `Z`
        ].join(" ");

        rinkGroup.append("path")
            .attr("d", d)
            .attr("stroke", "red")
            .attr("stroke-width", 2)
            .attr("stroke-opacity", 0.7)
            .attr("fill", "lightblue")
            .attr("fill-opacity", 0.3);
    });
}

function drawNets() {
    [-89, 89].forEach(goalX => {
        const dir = goalX < 0 ? 1 : -1;
        const x0 = goalX;
        const x1 = goalX - dir * 3.33;
        const y0 = -3;
        const y1 = 3;

        const d = [
            `M ${scaleX(x0)} ${scaleY(y0)}`,
            `L ${scaleX(x1)} ${scaleY(y0 - 1)}`,
            `L ${scaleX(x1)} ${scaleY(y1 + 1)}`,
            `L ${scaleX(x0)} ${scaleY(y1)}`,
            `Z`
        ].join(" ");

        rinkGroup.append("path")
            .attr("d", d)
            .attr("stroke", "red")
            .attr("stroke-width", 2)
            .attr("stroke-opacity", 0.7)
            .attr("fill", "none");
    });
}

function drawFaceoffDots() {
    // Center dot
    rinkGroup.append("circle")
        .attr("cx", scaleX(0))
        .attr("cy", scaleY(0))
        .attr("r", scaleX(0.5) - scaleX(0))
        .attr("fill", "red")
        .attr("stroke", "white")
        .attr("stroke-width", 1);

    // Faceoff spots
    const faceoffSpots = [-69, -22, 22, 69];
    faceoffSpots.forEach(x => {
        [22, -22].forEach(y => {
            rinkGroup.append("circle")
                .attr("cx", scaleX(x))
                .attr("cy", scaleY(y))
                .attr("r", scaleX(1) - scaleX(0))
                .attr("fill", "red")
                .attr("stroke", "white")
                .attr("stroke-width", 1);
        });
    });

    // End-zone circles
    [-69, 69].forEach(x => {
        [22, -22].forEach(y => {
            rinkGroup.append("circle")
                .attr("cx", scaleX(x))
                .attr("cy", scaleY(y))
                .attr("r", scaleX(15) - scaleX(0))
                .attr("stroke", "red")
                .attr("stroke-width", 2)
                .attr("stroke-opacity", 0.7)
                .attr("fill", "none");
        });
    });
}

function drawDirectionArrow() {
    // Direction arrow - positioned below the rink
    const arrowY = 580; // Closer to rink but with clearance
    const arrowStartX = svg.attr("width") * 0.65;
    const arrowEndX = svg.attr("width") * 0.35;
    const arrowHeadSize = 15;

    svg.append("text")
        .attr("x", svg.attr("width") / 2)
        .attr("y", 600) // Closer positioning for direction text
        .attr("text-anchor", "middle")
        .attr("font-family", "Arial, sans-serif")
        .attr("font-size", "16px")
        .attr("font-weight", "bold")
        .attr("fill", "black")
        .text("Direction of Play");

    // Arrow shaft
    svg.append("line")
        .attr("x1", arrowStartX)
        .attr("y1", arrowY)
        .attr("x2", arrowEndX + arrowHeadSize)
        .attr("y2", arrowY)
        .attr("stroke", "black")
        .attr("stroke-width", 4);

    // Arrow head
    svg.append("path")
        .attr("d", `M ${arrowEndX} ${arrowY} L ${arrowEndX + arrowHeadSize} ${arrowY - arrowHeadSize / 2} L ${arrowEndX + arrowHeadSize} ${arrowY + arrowHeadSize / 2} Z`)
        .attr("fill", "black");

    // Data disclaimer
    svg.append("text")
        .attr("x", svg.attr("width") / 2)
        .attr("y", 620) // Closer positioning for disclaimer
        .attr("text-anchor", "middle")
        .attr("font-family", "Arial, sans-serif")
        .attr("font-size", "12px")
        .attr("font-style", "italic")
        .attr("fill", "#666")
        .text("Note: Shots with xG < 0.015 are randomly downsampled by 10x to reduce bandwidth");
}

function filterData() {
    // Filter data based on current controls
    let filteredData = allShotsData;

    // Team filter
    if (selectedTeam !== 'all') {
        filteredData = filteredData.filter(d => d.team === selectedTeam);
    }

    // Probability filter
    filteredData = filteredData.filter(d => d.xG >= currentProbability);

    currentFilteredData = filteredData;
    return filteredData;
}

function updateVisualization() {
    try {
        const filteredData = filterData();

        // Remove existing shots
        rinkGroup.selectAll("circle.shot").remove();

        // Add expected goals (yellow)
        rinkGroup.selectAll("circle.expected-shot")
            .data(filteredData)
            .enter()
            .append("circle")
            .attr("class", "shot expected-shot")
            .attr("cx", d => scaleX(d.x))
            .attr("cy", d => scaleY(d.y))
            .attr("r", d => Math.max(3, Math.min(8, d.xG * 12))) // Size based on xG
            .attr("fill", "#FFD700") // Gold/yellow
            .attr("opacity", 0.7)
            .attr("stroke", "white")
            .attr("stroke-width", 1)
            .append("title")
            .text(d => `Team: ${d.team}\nLocation: (${d.x.toFixed(1)}, ${d.y.toFixed(1)})\nxG: ${d.xG.toFixed(3)}\nActual: ${d.goal ? 'Goal' : 'No Goal'}`);

        // Add actual goals (green) - overlay
        if (showActualGoals) {
            const actualGoals = filteredData.filter(d => d.goal);

            rinkGroup.selectAll("circle.actual-goal")
                .data(actualGoals)
                .enter()
                .append("circle")
                .attr("class", "shot actual-goal")
                .attr("cx", d => scaleX(d.x))
                .attr("cy", d => scaleY(d.y))
                .attr("r", d => Math.max(4, Math.min(9, d.xG * 12 + 1))) // Slightly larger
                .attr("fill", "#228B22") // Forest green
                .attr("opacity", 0.9)
                .attr("stroke", "white")
                .attr("stroke-width", 2)
                .append("title")
                .text(d => `Team: ${d.team}\nLocation: (${d.x.toFixed(1)}, ${d.y.toFixed(1)})\nxG: ${d.xG.toFixed(3)}\nACTUAL GOAL ⚽`);
        }

        // Update statistics
        updateStatistics();

    } catch (error) {
        console.error("Error in updateVisualization:", error);
    }
}

function updateStatistics() {
    const DOWNSAMPLE_THRESHOLD = 0.015;

    // Find the stats panel and the note, creating the note if it doesn't exist.
    const statsPanel = d3.select("#statistics-panel");
    let note = statsPanel.select(".stats-note");
    if (note.empty() && !statsPanel.empty()) {
        note = statsPanel.append("p")
            .attr("class", "stats-note")
            .style("font-size", "11px")
            .style("margin-top", "10px")
            .style("color", "#c9302c")
            .style("font-style", "italic");
    }

    if (currentProbability < DOWNSAMPLE_THRESHOLD) {
        // Below the threshold, the displayed data is downsampled.
        // We MUST use the pre-calculated stats for accuracy.
        const stats = teamStats[selectedTeam];

        if (!stats) {
            d3.select("#total-shots").text('N/A');
            d3.select("#expected-goals").text('N/A');
            d3.select("#actual-goals").text('N/A');
            d3.select("#conversion-rate").text('N/A');
            if (!note.empty()) note.text("");
            return;
        }

        const totalShots = stats.total_shots;
        const expectedGoals = stats.total_xg;
        const actualGoals = stats.total_goals;

        d3.select("#total-shots").text(totalShots.toLocaleString());
        d3.select("#expected-goals").text(expectedGoals.toFixed(1));
        d3.select("#actual-goals").text(actualGoals.toLocaleString());

        const difference = expectedGoals > 0 ? ((actualGoals - expectedGoals) / expectedGoals) * 100 : 0;
        const diffText = (difference > 0 ? "+" : "") + difference.toFixed(1) + "%";

        const diffElement = d3.select("#conversion-rate");
        diffElement.text(diffText)
            .style("color", difference > 0 ? "green" : "red");

        // Dynamically update the label
        d3.select("label[for='conversion-rate']").text("Difference");

        if (!note.empty()) {
            note.text(`Showing stats for full dataset. Live filtered stats available for xG ≥ ${DOWNSAMPLE_THRESHOLD}.`);
        }

    } else {
        // Above the threshold, data is not downsampled, so we can calculate dynamically.
        const totalShots = currentFilteredData.length;
        const expectedGoals = d3.sum(currentFilteredData, d => d.xG);
        const actualGoals = d3.sum(currentFilteredData, d => d.goal ? 1 : 0);

        d3.select("#total-shots").text(totalShots.toLocaleString());
        d3.select("#expected-goals").text(expectedGoals.toFixed(1));
        d3.select("#actual-goals").text(actualGoals.toLocaleString());

        const difference = expectedGoals > 0 ? ((actualGoals - expectedGoals) / expectedGoals) * 100 : 0;
        const diffText = (difference > 0 ? "+" : "") + difference.toFixed(1) + "%";

        const diffElement = d3.select("#conversion-rate");
        diffElement.text(diffText)
            .style("color", difference > 0 ? "green" : "red");

        // Dynamically update the label
        d3.select("label[for='conversion-rate']").text("Difference");

        if (!note.empty()) {
            note.text(""); // Clear the note
        }
    }
}

// Add keyboard shortcuts
document.addEventListener('keydown', function (event) {
    const slider = document.getElementById('probability-slider');
    const currentValue = parseFloat(slider.value);

    switch (event.key) {
        case 'ArrowUp':
        case 'ArrowRight':
            event.preventDefault();
            slider.value = Math.min(1, currentValue + 0.05);
            slider.dispatchEvent(new Event('input'));
            break;
        case 'ArrowDown':
        case 'ArrowLeft':
            event.preventDefault();
            slider.value = Math.max(0, currentValue - 0.05);
            slider.dispatchEvent(new Event('input'));
            break;
        case ' ':
            event.preventDefault();
            document.getElementById('show-actual-goals').click();
            break;
    }
});