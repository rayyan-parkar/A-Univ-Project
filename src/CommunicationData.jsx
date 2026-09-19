import React, { useState, useEffect, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title } from 'chart.js';
import { Scatter } from 'react-chartjs-2';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
);

const MAX_POINTS = 50;

const STYLE_CACHE = new Array(MAX_POINTS + 1);
for (let len = 1; len <= MAX_POINTS; len++) {
    const background = new Array(len);
    const border = new Array(len);
    const radii = new Array(len);

    for (let i = 0; i < len; i++) {
        const factor = len > 1 ? i / (len - 1) : 1;
        const alpha = (0.15 + 0.8 * factor).toFixed(3);
        background[i] = `rgba(54, 162, 235, ${alpha})`;
        border[i] = `rgba(30, 64, 175, ${alpha})`;
        radii[i] = 3 + 2.5 * factor;
    }

    STYLE_CACHE[len] = {
        backgroundColors: background,
        borderColors: border,
        pointRadii: radii,
    };
}

const dottedZeroLinePlugin = {
    id: 'dottedZeroLinePlugin',
    beforeDraw(chart) {
        const { ctx, scales: { x: xAxis, y: yAxis } } = chart;
        const xZero = xAxis.getPixelForValue(0);
        const yZero = yAxis.getPixelForValue(0);

        if (xZero < xAxis.left || xZero > xAxis.right || yZero < yAxis.top || yZero > yAxis.bottom) {
            return;
        }

        ctx.save();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);

        ctx.beginPath();
        ctx.moveTo(xZero, yAxis.top);
        ctx.lineTo(xZero, yAxis.bottom);
        ctx.moveTo(xAxis.left, yZero);
        ctx.lineTo(xAxis.right, yZero);
        ctx.stroke();
        ctx.restore();
    },
};

const PLUGINS = [dottedZeroLinePlugin];

const hideZeroTick = (value) => (value === 0 ? '' : value);
const gridColor = (context) => (context.tick.value === 0 ? 'transparent' : 'rgba(0, 0, 0, 0.1)');

const CHART_OPTIONS = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
        intersect: false,
        mode: 'point',
    },
    plugins: {
        legend: { display: false },
        title: { display: false },
        tooltip: { enabled: false },
    },
    scales: {
        x: {
            type: 'linear',
            position: 'center',
            min: -1.5,
            max: 1.5,
            grid: {
                color: gridColor,
                lineWidth: 1,
            },
            ticks: {
                callback: hideZeroTick,
                maxTicksLimit: 7,
            },
            border: { display: false },
        },
        y: {
            type: 'linear',
            position: 'center',
            min: -1.5,
            max: 1.5,
            grid: {
                color: gridColor,
                lineWidth: 1,
            },
            ticks: {
                callback: hideZeroTick,
                maxTicksLimit: 7,
            },
            border: { display: false },
        },
    },
    animation: false,
    elements: {
        point: {
            radius: 4,
            hoverRadius: 6,
        },
    },
};

const CommunicationData = React.memo(function CommunicationData({ latestData }) {
    const [signalData, setSignalData] = useState([]);

    useEffect(() => {
        if (!Array.isArray(latestData) || latestData.length < 2) return;
        const x = parseFloat(latestData[0]);
        const y = parseFloat(latestData[1]);
        if (Number.isNaN(x) || Number.isNaN(y)) return;

        setSignalData((prev) => {
            const next = prev.length >= MAX_POINTS ? prev.slice(1) : prev.slice();
            next.push({ x, y });
            return next;
        });
    }, [latestData]);

    const chartData = useMemo(() => {
        const styles = STYLE_CACHE[signalData.length] || STYLE_CACHE[MAX_POINTS] || {
            backgroundColors: '#36a2eb',
            borderColors: '#1e40af',
            pointRadii: 4,
        };

        return {
            datasets: [{
                label: 'Communication Points',
                data: signalData,
                backgroundColor: styles.backgroundColors,
                borderColor: styles.borderColors,
                pointRadius: styles.pointRadii,
                pointHoverRadius: 6,
                showLine: false,
            }],
        };
    }, [signalData]);

    return (
        <div className="comms-graph">
            <Scatter data={chartData} options={CHART_OPTIONS} plugins={PLUGINS} />
        </div>
    );
});

export default CommunicationData;