import React, { useEffect } from "react";
import "./AppLoader.css";


//const useRenderCount = (componentName) => {
//    const renderCount = useRef(0); // Initialize once and persist across renders
//    renderCount.current += 1;
//    console.log(`${componentName} render count: ${renderCount.current}`);
//};

const AppLoader = () => {
   // useRenderCount("AppLoader");

    useEffect(() => {
        console.log("AppLoader mounted");
        return () => console.log("AppLoader unmounted");
    }, []);

    return (
        <section
            className="app-loader"
            
        >
            <div className="bouncing-loader">
                <div></div>
                <div></div>
                <div></div>
            </div>
            <img src="/textures/UBC_Alternate_reverse_white.png" className="img1" alt="EML logo" />
            <img src="/textures/PALSOL-1.2b-Primary-UBC-Shield(white).png" className="img2" alt="AL logo" />
        </section>
    );
};

//const AppLoader = () => {

//    useRenderCount("AppLoader");

//    console.log("AppLoader render");

   
//  return (
//    <section className='app-loader'>
//      <div className='bouncing-loader'>
//        <div></div>
//        <div></div>
//        <div></div>
//        <div></div>
//        <div></div>
//      </div>
//        <img src= "/textures/UBC_Alternate_reverse_white.png" class="img1" alt="EML logo"/>
//        <img src= "/textures/PALSOL-1.2b-Primary-UBC-Shield(white).png" class="img2" alt="AL logo"/>
//    </section>
//  );
//};


export default AppLoader;