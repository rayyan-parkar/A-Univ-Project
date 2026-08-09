import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title } from 'chart.js';
import { Scatter } from 'react-chartjs-2';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
);

const CommunicationData = React.memo(function CommunicationData({ latestData }) {
    const [signalData, setSignalData] = useState([]);

    useEffect(() => {
        if (latestData != null && Array.isArray(latestData) && latestData.length > 0) {
            setSignalData(prev => {
                const combined = [...prev, ...latestData];
                return combined.length > 50 ? combined.slice(-50) : combined;
            });
        }
    }, [latestData]);

    const dottedZeroLinePlugin = useMemo(() => ({
        id: 'dottedZeroLinePlugin',
        beforeDraw: (chart) => {
            const { ctx, scales: { x: xAxis, y: yAxis } } = chart;
            
            // Early return if axes don't contain zero
            const xZero = xAxis.getPixelForValue(0);
            const yZero = yAxis.getPixelForValue(0);
            
            if (xZero < xAxis.left || xZero > xAxis.right || 
                yZero < yAxis.top || yZero > yAxis.bottom) {
                return;
            }

            ctx.save();
            ctx.strokeStyle = 'rgba(0,0,0,0.8)';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);
            
            ctx.beginPath();
            // Draw y-axis
            ctx.moveTo(xZero, yAxis.top);
            ctx.lineTo(xZero, yAxis.bottom);
            // Draw x-axis
            ctx.moveTo(xAxis.left, yZero);
            ctx.lineTo(xAxis.right, yZero);
            ctx.stroke();
            
            ctx.restore();
        }
    }), []);
    const chartData = useMemo(() => ({
        datasets: [{
            label: 'Communication Points',
            data: signalData,
            backgroundColor: 'rgba(54, 162, 235, 0.6)',
            borderColor: 'rgba(54, 162, 235, 1)',
            pointRadius: 4,
            pointHoverRadius: 6,
            showLine: false,
        }]
    }), [signalData]);

    // Memoise tick callback to prevent recreation
    const hideZeroTickCallback = useCallback((value) => value === 0 ? '' : value, []);
    
    // Memoise grid color callback
    const gridColorCallback = useCallback((context) => 
        context.tick.value === 0 ? 'transparent' : 'rgba(0, 0, 0, 0.1)', []);

    const chartOptions = useMemo(() => ({
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
                    color: gridColorCallback,
                    lineWidth: 1,
                },
                ticks: {
                    callback: hideZeroTickCallback,
                    maxTicksLimit: 7, // Ticks limited for performance
                },
                border: { display: false }
            },
            y: {
                type: 'linear', 
                position: 'center',
                min: -1.5,
                max: 1.5,
                grid: {
                    color: gridColorCallback,
                    lineWidth: 1,
                },
                ticks: {
                    callback: hideZeroTickCallback,
                    maxTicksLimit: 7, // Ticks limtied for performance
                },
                border: { display: false }
            },
        },
        animation: false,
        elements: {
            point: {
                radius: 4,
                hoverRadius: 6,
            }
        }
    }), [hideZeroTickCallback, gridColorCallback]);

    // Memoise plugins array to prevent recreation
    const plugins = useMemo(() => [dottedZeroLinePlugin], [dottedZeroLinePlugin]);

    return (
        <div className="comms-graph">
            <Scatter data={chartData} options={chartOptions} plugins={plugins} />
        </div>
    ); 
});

export default CommunicationData;