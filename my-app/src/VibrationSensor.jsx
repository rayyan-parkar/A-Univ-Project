import React, {useState, useEffect, useMemo} from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
);

const VibrationChart = React.memo(function VibrationChart({latestData, title}) {
    const [signalData, setSignalData] = useState(() => new Array(100).fill(0));

    // Memoise time array
    const time = useMemo(() => Array.from({length: 100}, (_, i) => i), []);

    useEffect(() => {
        if (latestData != null) {
            setSignalData(prev => {
                const newData = [...prev];
                newData.shift(); // Remove first element
                newData.push(parseFloat(latestData)); // Add new element at end
                return newData;
            });
        }
    }, [latestData]);

    // Memoise Y-axis range calculation
    const yRange = useMemo(() => {
        const validData = signalData.filter(val => val != null && !isNaN(val));
        
        if (validData.length === 0) {
            return { min: -1, max: 1 };
        }
        
        const min = Math.min(...validData);
        const max = Math.max(...validData);
        
        // Added so that flat lines are visible, don't show otherwise
        const padding = Math.abs(max - min) * 0.1 || 0.1;
        return { 
            min: min - padding, 
            max: max + padding 
        };
    }, [signalData]);

    const chartData = useMemo(() => ({
        labels: time,
        datasets: [{
            label: 'Vibration Signal',
            data: signalData,
            fill: false,
            borderColor: '#0066ff',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0, // Explicit no smoothing for performance
        }]
    }), [signalData, time]);

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
                    maxTicksLimit: 6, // Ticks limited for performance
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
            point: { radius: 0 }, // Ensure no points are drawn
            line: { borderWidth: 2 }
        }
    }), [yRange, time]);
    return (
        <div className='vibration-chart'>
            <h2>{title}</h2>
            <Line data={chartData} options={chartOptions} />
        </div>
    );
});

export default VibrationChart;