import React, { useState, useEffect, useMemo } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title } from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
);

const timeLabels = Array.from({ length: 100 }, (_, i) => i);

const VibrationChart = React.memo(function VibrationChart({ latestData, title }) {
    const [signalData, setSignalData] = useState(() => new Array(100).fill(0));

    useEffect(() => {
        if (latestData == null) return;
        const value = parseFloat(latestData);
        if (Number.isNaN(value)) return;

        setSignalData(prev => {
            const next = prev.slice(1);
            next.push(value);
            return next;
        });
    }, [latestData]);

    const yRange = useMemo(() => {
        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < signalData.length; i++) {
            const val = signalData[i];
            if (val != null && !Number.isNaN(val)) {
                if (val < min) min = val;
                if (val > max) max = val;
            }
        }

        if (!Number.isFinite(min) || !Number.isFinite(max)) {
            return { min: -1, max: 1 };
        }

        const padding = Math.abs(max - min) * 0.1 || 0.1;
        return {
            min: min - padding,
            max: max + padding
        };
    }, [signalData]);

    const chartData = useMemo(() => ({
        labels: timeLabels,
        datasets: [{
            label: 'Vibration Signal',
            data: signalData,
            fill: false,
            borderColor: '#0066ff',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0,
        }]
    }), [signalData]);

    const chartOptions = useMemo(() => ({
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
            intersect: false,
            mode: 'index',
        },
        plugins: {
            title: { display: false },
            legend: { display: false },
        },
        scales: {
            x: {
                type: 'linear',
                min: 0,
                max: 99,
                title: {
                    display: true,
                    text: 'Time',
                    color: '#000000',
                },
                ticks: {
                    stepSize: 10,
                    color: '#000000',
                },
                grid: {
                    display: true,
                },
            },
            y: {
                min: yRange.min,
                max: yRange.max,
                title: {
                    display: true,
                    text: 'Signal',
                    color: '#000000',
                },
                ticks: {
                    color: '#000000',
                    maxTicksLimit: 6,
                    callback: (value) => value.toFixed(1),
                },
                grid: {
                    zeroLineColor: '#000000',
                    zeroLineWidth: 2,
                }
            },
        },
        animation: false,
        elements: {
            point: { radius: 0 },
            line: { borderWidth: 2 }
        }
    }), [yRange]);

    return (
        <div className='vibration-chart'>
            <h2>{title}</h2>
            <Line data={chartData} options={chartOptions} />
        </div>
    );
});

export default VibrationChart;
