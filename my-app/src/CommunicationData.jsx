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
    },
    scales: {
        x: {
            type: 'linear',
            position: 'bottom',
            min: -1.5,
            max: 1.5,
            grid: {
                display: true,
                color: (context) => {
                    return context.tick.value === 0 ? 'rgba(0, 0, 0, 0.8)' : 'rgba(0, 0, 0, 0.1)';
                },
                borderDash: (context) => {
                    return context.tick.value === 0 ? [5, 5] : [];
                },
                lineWidth: (context) => {
                    return context.tick.value === 0 ? 2 : 1;
                }
            },
        },
        y: {
            min: -1.5,
            max: 1.5,
            grid: {
                display: true,
                color: (context) => {
                    return context.tick.value === 0 ? 'rgba(0, 0, 0, 0.8)' : 'rgba(0, 0, 0, 0.1)';
                },
                borderDash: (context) => {
                    return context.tick.value === 0 ? [5, 5] : [];
                },
                lineWidth: (context) => {
                    return context.tick.value === 0 ? 2 : 1;
                }
                },
                },
        },
    };

    return (
    <div className ="comms-graph">
        <Scatter data={chartData} options={options} />
    </div>
    ); 
};

export default CommunicationData;