import {useState, useEffect} from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title} from 'chart.js';
import { Scatter } from 'react-chartjs-2';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
);

function CommunicationData({latestData}) {

    const [signalData, setSignalData] = useState([]);

    useEffect(()=> {
    if (latestData !== null && latestData !== undefined && Array.isArray(latestData)) {
        setSignalData(prev => {
            const newData = [...prev, ...latestData]; // Add all new points
            
            // Keep only the last 50 points (sliding window)
            if (newData.length > 50) {
                return newData.slice(-50);
            }
            
            return newData;
        });
    }
    }, [latestData]);

    // Custom Plugin to draw dotted lines at axes

    const dottedZeroLinePlugin = {
        id: 'dottedZeroLinePlugin',
        beforeDraw: chart=> {
            const ctx = chart.ctx;
            const xAxis = chart.scales.x;
            const yAxis = chart.scales.y;

            // Do not draw anything if not axes

            if (xAxis.getPixelForValue(0)===xAxis.left || yAxis.getPixelForValue(0) === yAxis.top) {
                return;
            }

            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(0,0,0,0.8)';
            ctx.lineWidth = 1;
            ctx.setLineDash([5,5]);

            // Draw y-axis
            ctx.moveTo(xAxis.getPixelForValue(0), yAxis.top);
            ctx.lineTo(xAxis.getPixelForValue(0), yAxis.bottom);

            //Draw x-axis
            ctx.moveTo(xAxis.left, yAxis.getPixelForValue(0));
            ctx.lineTo(xAxis.right, yAxis.getPixelForValue(0));

            ctx.stroke();
            ctx.restore();
        }
    }
   const chartData = {
    datasets: [
        {
            label: 'Communication Points',
            data: signalData, // Use signalData directly (should be array of {x, y} objects)
            backgroundColor: 'rgba(54, 162, 235, 0.6)',
            borderColor: 'rgba(54, 162, 235, 1)',
            pointRadius: 4,
            pointHoverRadius: 6,
            showLine: false, // This prevents connecting the dots with lines
        }
      ],
    };

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                display: false,
            },
            title: {
                display: false,
            },
            tooltip: {
                enabled: false,
            },
            // Use the custom plugin
            dottedZeroLine: true, 
        },
        scales: {
            x: {
                type: 'linear',
                position: 'center',
                min: -1.5,
                max: 1.5,
                grid: {
                    // Make the default zero line invisible, so our plugin can draw it
                    color: (context) => context.tick.value === 0 ? 'transparent' : 'rgba(0, 0, 0, 0.1)',
                    lineWidth: 1,
                },
                ticks: {
                    // Return an empty string for the '0' label to hide it
                    callback: function(value) {
                        if (value === 0) {
                            return '';
                        }
                        return value;
                    }
                },
                border: {
                    display: false, // Hide the default border
                }
            },

            y: {
                type: 'linear', 
                position: 'center',
                min: -1.5,
                max: 1.5,
                grid: {
                    // Make the default zero line invisible
                    color: (context) => context.tick.value === 0 ? 'transparent' : 'rgba(0, 0, 0, 0.1)',
                    lineWidth: 1,
                },
                ticks: {
                    // Return an empty string for the '0' label to hide it
                    callback: function(value) {
                        if (value === 0) {
                            return '';
                        }
                        return value;
                    }
                },
                border: {
                    display: false, // Hide the default border
                }
            },
        },
    };

    return (
    <div className ="comms-graph">
        <Scatter data={chartData} options={options} plugins={[dottedZeroLinePlugin]}/>
    </div>
    ); 
};

export default CommunicationData;